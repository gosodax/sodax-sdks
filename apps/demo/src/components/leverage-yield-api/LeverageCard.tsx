import { SelectChain } from '@/components/swaps-api/SelectChain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMutationFailureMessage } from '@/lib/utils';
import { formatUnits, parseUnits } from 'viem';
import type {
  CreateDepositIntentParamsV2,
  CreateWithdrawIntentParamsV2,
  LeverageVaultV2,
  LeverageYieldDepositQuoteRequestV2,
  LeverageYieldWithdrawQuoteRequestV2,
  SpokeChainKey,
  LeverageYieldSubmitTxRequestV2,
  XToken,
  ApprovalProgress,
} from '@sodax/dapp-kit';
import { Loader2 } from 'lucide-react';
import React, { type SetStateAction, useMemo, useState } from 'react';
import {
  ChainKeys,
  getSupportedSolverTokens,
  useSodaxContext,
  useXBalances,
  useGetUserHubWalletAddress,
  useLeverageYieldApiAllowance,
  useLeverageYieldApiApproveAndBroadcast,
  useLeverageYieldApiCreateDepositIntent,
  useLeverageYieldApiCreateWithdrawIntent,
  useLeverageYieldApiDeadline,
  useLeverageYieldApiDepositQuote,
  useLeverageYieldApiEffectiveApr,
  useLeverageYieldApiPosition,
  useLeverageYieldApiShareBalance,
  useLeverageYieldApiTotalAssets,
  useLeverageYieldApiVaults,
  useLeverageYieldApiWithdrawQuote,
  useLeverageYieldApiSubmitTx,
} from '@sodax/dapp-kit';
import { getXChainType, useEvmSwitchChain, useWalletProvider, useXAccount, useXService } from '@sodax/wallet-sdk-react';
import type { LeverageYieldApiOrder } from '@/components/leverage-yield-api/OrderStatus';
import { effectiveLeverageYieldApiBaseUrl } from '@/lib/sodaxSettings';
import { toIntentRequest } from '@/components/swaps-api/lib/mappers';
import { isSignableSwapsApiChain, signAndBroadcastSwapsApiTx } from '@/components/swaps-api/lib/signAndBroadcast';
import { useDebouncedValue } from '@/components/swaps-api/lib/useDebouncedValue';
import { useAppStore } from '@/zustand/useAppStore';

/** Vault-share decimals (lsoda* ERC-4626 shares are always 18 decimals). */
const SHARE_DECIMALS = 18;

/** Short button label for the step the wallet is on, or `null` once that step has landed. */
function approvalStepLabel({ step, phase, index, total }: ApprovalProgress): string | null {
  if (phase !== 'signing' && phase !== 'broadcast') return null;

  const counter = total > 1 ? ` (${index}/${total})` : '';
  const [action, pending] = step === 'allowance-reset' ? ['Reset approval', 'Resetting…'] : ['Approve', 'Approving…'];

  return `${phase === 'signing' ? action : pending}${counter}`;
}

/** `(100 - slippage)%` of `quotedAmount`, in bps to avoid float drift. */
function applySlippageMinOut(quotedAmount: string, slippagePct: string): string {
  const bps = BigInt(Math.round(Math.max(0, 100 - Number(slippagePct)) * 100));
  return ((BigInt(quotedAmount) * bps) / 10_000n).toString();
}

/** RAY (1e27 = 100%) → display percent. */
function formatRayPct(ray: string | undefined): string {
  if (ray === undefined) return '—';
  return `${(Number(ray) / 1e25).toFixed(2)}%`;
}

/** 18-decimal fixed-point (wei / WAD / vault shares) → trimmed human string. */
function formatUnits18(value: string | undefined, dp = 4): string {
  if (value === undefined) return '—';
  return Number(formatUnits(BigInt(value), 18)).toFixed(dp);
}

/** WAD health factor → human string; `type(uint256).max` (no debt) shows as ∞. */
function formatHealthFactor(wad: string | undefined): string {
  if (wad === undefined) return '—';
  const hf = Number(formatUnits(BigInt(wad), 18));
  return hf > 1e9 ? '∞' : hf.toFixed(2);
}

/** A token dropdown backed by the solver-supported token list for a chain. */
function SelectToken({
  tokens,
  value,
  onSelect,
  id,
  label,
}: {
  tokens: readonly XToken[];
  value: string;
  onSelect: (token: XToken) => void;
  id?: string;
  label?: string;
}) {
  return (
    <div className="space-y-2">
      {label && <Label htmlFor={id}>{label}</Label>}
      <Select
        value={value}
        onValueChange={address => {
          const token = tokens.find(t => t.address === address);
          if (token) onSelect(token);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select token" />
        </SelectTrigger>
        <SelectContent>
          {tokens.map(token => (
            <SelectItem key={token.address} value={token.address}>
              {token.symbol}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Leverage Yield API card. Every quote/allowance/intent/relay decision is delegated to the
 * `useLeverageYieldApi*` hooks (the backend `sodax.api.leverageYield.*` client); the only
 * client-side steps are allowance signing, sign-and-broadcast, and minor utils. Mirrors the
 * swaps-api `SwapCard`, focused on the EVM/wallet-signable path.
 */
export default function LeverageCard({
  setOrders,
}: {
  setOrders: (value: SetStateAction<LeverageYieldApiOrder[]>) => void;
}) {
  const { sodax } = useSodaxContext();
  const { openWalletModal, sodaxSettings } = useAppStore();
  // Per-call, so this page can point at a local leverage-yield API without moving the app-wide SDK.
  const apiConfig = useMemo(() => ({ baseURL: effectiveLeverageYieldApiBaseUrl(sodaxSettings) }), [sodaxSettings]);
  const supportedChains = useMemo(() => sodax.config.getSupportedSpokeChains() as string[], [sodax]);

  const [slippage, setSlippage] = useState<string>('0.5');
  // Controlled so the footer can show ONLY the active tab's action (deposit vs. withdraw).
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');

  // ── Vault registry ──
  const { data: vaults } = useLeverageYieldApiVaults({ params: { apiConfig } });
  const [vaultName, setVaultName] = useState<string>('');
  const selectedVault: LeverageVaultV2 | undefined = useMemo(
    () => vaults?.find(v => v.name === vaultName),
    [vaults, vaultName],
  );

  // ── Vault info panel ──
  const { data: effectiveApr } = useLeverageYieldApiEffectiveApr({
    params: { vault: selectedVault?.vault, apiConfig },
  });
  const { data: position } = useLeverageYieldApiPosition({ params: { vault: selectedVault?.vault, apiConfig } });
  const { data: totalAssets } = useLeverageYieldApiTotalAssets({ params: { vault: selectedVault?.vault, apiConfig } });

  const { data: deadlineData, refetch: refetchDeadline } = useLeverageYieldApiDeadline({ params: { apiConfig } });

  // ══════════════════════════════ DEPOSIT ══════════════════════════════
  const [depositChain, setDepositChain] = useState<string>(ChainKeys.ARBITRUM_MAINNET);
  const depositTokens = useMemo(
    () => (depositChain ? getSupportedSolverTokens(depositChain as SpokeChainKey) : []),
    [depositChain],
  );
  const [depositToken, setDepositToken] = useState<XToken | undefined>(undefined);
  const [depositAmount, setDepositAmount] = useState<string>('');
  const debouncedDepositAmount = useDebouncedValue(depositAmount);

  const depositAccount = useXAccount({ xChainId: depositChain as SpokeChainKey });
  const depositWalletProvider = useWalletProvider({ xChainId: depositChain as SpokeChainKey });
  const { isWrongChain: isDepositWrongChain, handleSwitchChain: handleDepositSwitchChain } = useEvmSwitchChain({
    xChainId: depositChain as SpokeChainKey,
  });

  // Input-token balance is a wallet-layer read (not part of the Leverage Yield API).
  const depositXService = useXService({ xChainType: getXChainType(depositChain as SpokeChainKey) });
  const { data: depositBalances } = useXBalances({
    params: {
      xService: depositXService,
      xChainId: depositChain as SpokeChainKey,
      xTokens: depositToken ? [depositToken] : [],
      address: depositAccount.address,
    },
  });
  const depositTokenBalance = depositBalances?.[depositToken?.address ?? ''] ?? 0n;

  const depositQuoteBody: LeverageYieldDepositQuoteRequestV2 | undefined = useMemo(() => {
    if (!selectedVault || !depositToken || !debouncedDepositAmount || Number(debouncedDepositAmount) <= 0) {
      return undefined;
    }
    return {
      vault: selectedVault.vault,
      tokenSrc: depositToken.address,
      tokenSrcChainKey: depositChain,
      amount: parseUnits(debouncedDepositAmount, depositToken.decimals).toString(),
      quoteType: 'exact_input',
    };
  }, [selectedVault, depositToken, debouncedDepositAmount, depositChain]);

  const { data: depositQuote, isFetching: isDepositQuoting } = useLeverageYieldApiDepositQuote({
    params: { body: depositQuoteBody, apiConfig },
  });

  const depositIntentParams: CreateDepositIntentParamsV2 | undefined = useMemo(() => {
    if (!selectedVault || !depositToken || !depositAccount.address || !depositQuote?.quotedAmount) return undefined;
    return {
      vault: selectedVault.vault,
      srcChainKey: depositChain,
      srcAddress: depositAccount.address,
      inputToken: depositToken.address,
      inputAmount: parseUnits(debouncedDepositAmount, depositToken.decimals).toString(),
      minOutputAmount: applySlippageMinOut(depositQuote.quotedAmount, slippage),
      deadline: deadlineData?.deadline,
    };
  }, [
    selectedVault,
    depositToken,
    depositAccount.address,
    depositQuote,
    depositChain,
    debouncedDepositAmount,
    slippage,
    deadlineData,
  ]);

  const { data: allowance } = useLeverageYieldApiAllowance({
    params: { body: depositIntentParams, apiConfig },
  });
  const hasAllowed = allowance?.valid === true;

  // lsoda* shares are minted to the user's derived HUB WALLET, not the EOA (see the SDK `deposit()`
  // `dstAddress: hubWallet`). Querying `balanceOf(vault, EOA)` always returns 0 — resolve the hub
  // wallet and read the balance there.
  const { data: depositHubWallet } = useGetUserHubWalletAddress({
    params: { spokeChainId: depositChain as SpokeChainKey, spokeAddress: depositAccount.address },
  });
  const { data: shareBalance } = useLeverageYieldApiShareBalance({
    params: { vault: selectedVault?.vault, owner: depositHubWallet, apiConfig },
  });

  const { mutateAsyncSafe: approve } = useLeverageYieldApiApproveAndBroadcast();
  const { mutateAsyncSafe: createDepositIntent } = useLeverageYieldApiCreateDepositIntent();
  const { mutateAsyncSafe: submitTx } = useLeverageYieldApiSubmitTx();

  const [isApproving, setIsApproving] = useState(false);
  // A guarded token needs two signatures; one flat "Approving…" across both looks like a double charge.
  const [approvalProgress, setApprovalProgress] = useState<ApprovalProgress | null>(null);
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  const handleApprove = async (): Promise<void> => {
    if (!depositIntentParams || !depositWalletProvider) return;
    setDepositError(null);
    setIsApproving(true);
    try {
      // The hook owns plan → sign → broadcast → wait (stale-allowance reset included) and invalidates
      // the allowance query itself.
      const result = await approve({
        body: depositIntentParams,
        walletProvider: depositWalletProvider,
        apiConfig,
        onProgress: setApprovalProgress,
      });
      if (!result.ok) {
        setDepositError(formatMutationFailureMessage(result.error, 'Approve failed'));
        return;
      }
    } catch (error) {
      setDepositError(formatMutationFailureMessage(error, 'Approve signing failed'));
    } finally {
      setIsApproving(false);
      setApprovalProgress(null);
    }
  };

  const handleDeposit = async (): Promise<void> => {
    if (!depositIntentParams || !depositWalletProvider || !depositAccount.address) return;
    setDepositError(null);
    setIsDepositing(true);
    try {
      // 1. The API builds the unsigned deposit create-intent tx + intent + relay data.
      const created = await createDepositIntent({ body: depositIntentParams, apiConfig });
      if (!created.ok) {
        setDepositError(formatMutationFailureMessage(created.error, 'Create deposit intent failed'));
        return;
      }
      const { tx, intent, relayData } = created.value;

      // 2. Sign + broadcast on the source chain.
      const spokeTxHash = await signAndBroadcastSwapsApiTx({
        chainKey: depositChain as SpokeChainKey,
        tx,
        walletProvider: depositWalletProvider,
      });

      // 3. Hand the tx back to the API for relay + solver post-execution.
      const request: LeverageYieldSubmitTxRequestV2 = {
        txHash: spokeTxHash,
        srcChainKey: depositChain,
        walletAddress: depositAccount.address,
        intent: toIntentRequest(intent),
        relayData: relayData.payload,
        operation: 'deposit',
      };
      const submitted = await submitTx({ request, apiConfig });
      if (!submitted.ok) {
        setDepositError(formatMutationFailureMessage(submitted.error, 'Submit tx failed'));
        return;
      }
      setOrders(prev => [
        ...prev,
        { txHash: spokeTxHash, srcChainKey: depositChain, apiBaseURL: apiConfig.baseURL, kind: 'deposit' },
      ]);
    } catch (error) {
      setDepositError(formatMutationFailureMessage(error, 'Deposit signing failed'));
    } finally {
      setIsDepositing(false);
    }
  };

  // ══════════════════════════════ WITHDRAW ══════════════════════════════
  // One chain for the whole withdraw: the user signs the hub-wallet spend on it AND receives the
  // swapped-out token there. It must be the chain the position was deposited from — that's where the
  // lsoda*-holding hub wallet is derived.
  const [withdrawChain, setWithdrawChain] = useState<string>(ChainKeys.ARBITRUM_MAINNET);
  const withdrawTokens = useMemo(
    () => (withdrawChain ? getSupportedSolverTokens(withdrawChain as SpokeChainKey) : []),
    [withdrawChain],
  );
  const [withdrawToken, setWithdrawToken] = useState<XToken | undefined>(undefined);
  const [withdrawShares, setWithdrawShares] = useState<string>('');
  const debouncedWithdrawShares = useDebouncedValue(withdrawShares);

  const withdrawAccount = useXAccount({ xChainId: withdrawChain as SpokeChainKey });
  const withdrawWalletProvider = useWalletProvider({ xChainId: withdrawChain as SpokeChainKey });
  const { isWrongChain: isWithdrawWrongChain, handleSwitchChain: handleWithdrawSwitchChain } = useEvmSwitchChain({
    xChainId: withdrawChain as SpokeChainKey,
  });

  // The withdraw spends lsoda* from the hub wallet derived on this chain — show that balance/Max.
  const { data: withdrawHubWallet } = useGetUserHubWalletAddress({
    params: { spokeChainId: withdrawChain as SpokeChainKey, spokeAddress: withdrawAccount.address },
  });
  const { data: withdrawShareBalance } = useLeverageYieldApiShareBalance({
    params: { vault: selectedVault?.vault, owner: withdrawHubWallet, apiConfig },
  });

  const withdrawQuoteBody: LeverageYieldWithdrawQuoteRequestV2 | undefined = useMemo(() => {
    if (!selectedVault || !withdrawToken || !withdrawChain || Number(debouncedWithdrawShares) <= 0) return undefined;
    return {
      vault: selectedVault.vault,
      srcChainKey: withdrawChain,
      tokenDst: withdrawToken.address,
      tokenDstChainKey: withdrawChain,
      amount: parseUnits(debouncedWithdrawShares, SHARE_DECIMALS).toString(),
      quoteType: 'exact_input',
    };
  }, [selectedVault, withdrawToken, withdrawChain, debouncedWithdrawShares]);

  const { data: withdrawQuote, isFetching: isWithdrawQuoting } = useLeverageYieldApiWithdrawQuote({
    params: { body: withdrawQuoteBody, apiConfig },
  });

  const withdrawIntentParams: CreateWithdrawIntentParamsV2 | undefined = useMemo(() => {
    if (!selectedVault || !withdrawToken || !withdrawAccount.address) return undefined;
    if (!withdrawQuote?.quotedAmount) return undefined;
    return {
      vault: selectedVault.vault,
      srcChainKey: withdrawChain,
      srcAddress: withdrawAccount.address,
      dstChainKey: withdrawChain,
      outputToken: withdrawToken.address,
      inputAmount: parseUnits(debouncedWithdrawShares, SHARE_DECIMALS).toString(),
      minOutputAmount: applySlippageMinOut(withdrawQuote.quotedAmount, slippage),
      recipient: withdrawAccount.address,
      deadline: deadlineData?.deadline,
    };
  }, [
    selectedVault,
    withdrawToken,
    withdrawAccount.address,
    withdrawQuote,
    withdrawChain,
    debouncedWithdrawShares,
    slippage,
    deadlineData,
  ]);

  const { mutateAsyncSafe: createWithdrawIntent } = useLeverageYieldApiCreateWithdrawIntent();
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const handleWithdraw = async (): Promise<void> => {
    if (!withdrawIntentParams || !withdrawWalletProvider || !withdrawAccount.address) return;
    setWithdrawError(null);
    setIsWithdrawing(true);
    try {
      // Refresh the deadline just before building so the intent isn't already expired.
      await refetchDeadline();
      const created = await createWithdrawIntent({ body: withdrawIntentParams, apiConfig });
      if (!created.ok) {
        setWithdrawError(formatMutationFailureMessage(created.error, 'Create withdraw intent failed'));
        return;
      }
      const { tx, intent, relayData } = created.value;

      const spokeTxHash = await signAndBroadcastSwapsApiTx({
        chainKey: withdrawChain as SpokeChainKey,
        tx,
        walletProvider: withdrawWalletProvider,
      });

      const request: LeverageYieldSubmitTxRequestV2 = {
        txHash: spokeTxHash,
        srcChainKey: withdrawChain,
        walletAddress: withdrawAccount.address,
        intent: toIntentRequest(intent),
        relayData: relayData.payload,
        operation: 'withdraw',
      };
      const submitted = await submitTx({ request, apiConfig });
      if (!submitted.ok) {
        setWithdrawError(formatMutationFailureMessage(submitted.error, 'Submit tx failed'));
        return;
      }
      setOrders(prev => [
        ...prev,
        { txHash: spokeTxHash, srcChainKey: withdrawChain, apiBaseURL: apiConfig.baseURL, kind: 'withdraw' },
      ]);
    } catch (error) {
      setWithdrawError(formatMutationFailureMessage(error, 'Withdraw signing failed'));
    } finally {
      setIsWithdrawing(false);
    }
  };

  const depositSignable =
    !depositChain ||
    isSignableSwapsApiChain(depositChain as SpokeChainKey) ||
    getXChainType(depositChain as SpokeChainKey) === 'EVM';
  const withdrawSignable = !withdrawChain || isSignableSwapsApiChain(withdrawChain as SpokeChainKey);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Leverage Yield API</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Vault selector + info */}
        <div className="space-y-2">
          <Label htmlFor="vault">Vault</Label>
          <Select value={vaultName} onValueChange={setVaultName}>
            <SelectTrigger id="vault">
              <SelectValue placeholder="Select a leverage vault" />
            </SelectTrigger>
            <SelectContent>
              {(vaults ?? []).map(v => (
                <SelectItem key={v.name} value={v.name}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedVault && (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div>Effective APR: {formatRayPct(effectiveApr?.effectiveNetAprRay)}</div>
            <div>Total Assets: {formatUnits18(totalAssets?.totalAssets)}</div>
            {position && (
              <>
                <div>LTV: {(Number(position.ltv) / 100).toFixed(2)}%</div>
                <div>Health Factor: {formatHealthFactor(position.healthFactor)}</div>
              </>
            )}
            <div>Your Shares: {formatUnits18(shareBalance?.balance, 6)}</div>
            {depositHubWallet && (
              <div className="pt-1 text-xs text-muted-foreground break-all">
                Position wallet (holds lsoda*): {depositHubWallet}
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="slippage">Slippage (%)</Label>
          <Input id="slippage" value={slippage} onChange={e => setSlippage(e.target.value)} />
        </div>

        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'deposit' | 'withdraw')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="deposit">Deposit</TabsTrigger>
            <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
          </TabsList>

          {/* ── DEPOSIT ── */}
          <TabsContent value="deposit" className="space-y-4">
            <SelectChain
              chainList={supportedChains}
              value={depositChain}
              setChain={c => {
                setDepositChain(c);
                setDepositToken(undefined);
              }}
              placeholder="Source chain"
              id="deposit-chain"
              label="Source chain"
            />
            <SelectToken
              tokens={depositTokens}
              value={depositToken?.address ?? ''}
              onSelect={setDepositToken}
              id="deposit-token"
              label="Input token"
            />
            <div className="space-y-2">
              <Label htmlFor="deposit-amount">Amount</Label>
              <Input
                id="deposit-amount"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                placeholder="0.0"
              />
              {depositToken && depositAccount.address && (
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Balance: {formatUnits(depositTokenBalance, depositToken.decimals)} {depositToken.symbol}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 -m-1.5 p-1.5 underline"
                    onClick={() => setDepositAmount(formatUnits(depositTokenBalance, depositToken.decimals))}
                  >
                    Max
                  </button>
                </div>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              Quoted shares:{' '}
              {isDepositQuoting ? 'quoting…' : depositQuote ? formatUnits18(depositQuote.quotedAmount, 6) : '—'}
            </div>
            {depositError && <div className="text-red-500 text-sm wrap-anywhere">{depositError}</div>}
          </TabsContent>

          {/* ── WITHDRAW ── */}
          <TabsContent value="withdraw" className="space-y-4">
            <SelectChain
              chainList={supportedChains}
              value={withdrawChain}
              setChain={c => {
                setWithdrawChain(c);
                setWithdrawToken(undefined);
              }}
              placeholder="Chain (must match your deposit chain)"
              id="withdraw-chain"
              label="Chain"
            />
            <SelectToken
              tokens={withdrawTokens}
              value={withdrawToken?.address ?? ''}
              onSelect={setWithdrawToken}
              id="withdraw-token"
              label="Output token"
            />
            <div className="space-y-2">
              <Label htmlFor="withdraw-shares">Shares (lsoda*)</Label>
              <Input
                id="withdraw-shares"
                value={withdrawShares}
                onChange={e => setWithdrawShares(e.target.value)}
                placeholder="0.0"
              />
              {withdrawShareBalance && withdrawAccount.address && (
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>Your shares: {formatUnits18(withdrawShareBalance.balance, 6)}</span>
                  <button
                    type="button"
                    className="shrink-0 -m-1.5 p-1.5 underline"
                    onClick={() => setWithdrawShares(formatUnits(BigInt(withdrawShareBalance.balance), SHARE_DECIMALS))}
                  >
                    Max
                  </button>
                </div>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              Quoted output:{' '}
              {isWithdrawQuoting
                ? 'quoting…'
                : withdrawQuote && withdrawToken
                  ? `${formatUnits(BigInt(withdrawQuote.quotedAmount), withdrawToken.decimals)} ${withdrawToken.symbol}`
                  : '—'}
            </div>
            {withdrawError && <div className="text-red-500 text-sm wrap-anywhere">{withdrawError}</div>}
          </TabsContent>
        </Tabs>
      </CardContent>

      <CardFooter className="flex flex-col gap-2">
        {/* Only the active tab's actions are shown. */}
        {activeTab === 'deposit' &&
          (!depositAccount.address ? (
            <Button className="w-full" onClick={openWalletModal}>
              Connect wallet
            </Button>
          ) : isDepositWrongChain ? (
            <Button className="w-full" onClick={handleDepositSwitchChain}>
              Switch network
            </Button>
          ) : (
            <>
              {!hasAllowed && depositIntentParams && (
                <Button className="w-full" onClick={handleApprove} disabled={isApproving || !depositSignable}>
                  {isApproving ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {approvalProgress && approvalStepLabel(approvalProgress)}
                    </>
                  ) : (
                    'Approve'
                  )}
                </Button>
              )}
              <Button
                className="w-full"
                onClick={handleDeposit}
                disabled={!depositIntentParams || !hasAllowed || isDepositing || !depositSignable}
              >
                {isDepositing ? <Loader2 className="animate-spin" /> : 'Deposit'}
              </Button>
            </>
          ))}

        {activeTab === 'withdraw' &&
          (!withdrawAccount.address ? (
            <Button className="w-full" onClick={openWalletModal}>
              Connect wallet
            </Button>
          ) : isWithdrawWrongChain ? (
            <Button className="w-full" onClick={handleWithdrawSwitchChain}>
              Switch network
            </Button>
          ) : (
            <Button
              className="w-full"
              onClick={handleWithdraw}
              disabled={!withdrawIntentParams || isWithdrawing || !withdrawSignable}
            >
              {isWithdrawing ? <Loader2 className="animate-spin" /> : 'Withdraw'}
            </Button>
          ))}
      </CardFooter>
    </Card>
  );
}
