'use client';

import React, { type SetStateAction, useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { SelectToken } from '@/components/shared/SelectToken';
import {
  loadRadfiSession,
  useBalances,
  useBitcoinBalance,
  useBitcoinTradingSetup,
  useBridgeApiAllowance,
  useBridgeApiApproveAndBroadcast,
  useBridgeApiBridgeableAmount,
  useBridgeApiCreateBridgeIntent,
  useBridgeApiFee,
  useBridgeApiSubmitTx,
  useBridgeApiTokens,
  useNearStorageGate,
  useRequestTrustline,
  useSodaxContext,
  useStellarTrustlineCheck,
  ChainKeys,
  isNativeToken,
  type BitcoinRawTransaction,
  type BridgeSubmitTxRequestV2,
  type CreateBridgeIntentParamsV2,
  type Hex,
  type ApprovalProgress,
  type IBitcoinWalletProvider,
  type IStellarWalletProvider,
  type RequestOverrideConfig,
  type SpokeChainKey,
  type StellarChainKey,
  type XToken,
} from '@sodax/dapp-kit';
import {
  getXChainType,
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
  useXDisconnect,
} from '@sodax/wallet-sdk-react';
import { ArrowDownUp, ArrowLeftRight, Loader2 } from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import { PartnerFeeFields, usePartnerFeeDraft } from '@/components/shared/PartnerFeeFields';
import { useAppStore } from '@/zustand/useAppStore';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';
import { formatMutationFailureMessage, formatTokenAmount, rescaleTokenAmount } from '@/lib/utils';
import type { BridgeApiOrder } from '@/components/bridge-api/OrderStatus';
import { BRIDGE_API_MAX_PARTNER_FEE_BPS, effectiveBridgeApiBaseUrl } from '@/lib/sodaxSettings';
import { isSignableBridgeApiChain, signAndBroadcastBridgeApiTx } from '@/components/bridge-api/lib/signAndBroadcast';
import { toXToken } from '@/components/bridge-api/lib/mappers';

/** Short button label for the step the wallet is on, or `null` once that step has landed. */
function approvalStepLabel({ step, phase, index, total }: ApprovalProgress): string | null {
  if (phase !== 'signing' && phase !== 'broadcast') return null;

  const counter = total > 1 ? ` (${index}/${total})` : '';
  const [action, pending] = step === 'allowance-reset' ? ['Reset approval', 'Resetting…'] : ['Approve', 'Approving…'];

  return `${phase === 'signing' ? action : pending}${counter}`;
}

/** The API types the limit as a string, so parse it defensively: a malformed one must not throw in render. */
function parseLimitAmount(amount: string | undefined): bigint | undefined {
  if (amount === undefined) return undefined;
  try {
    return BigInt(amount);
  } catch {
    return undefined;
  }
}

/**
 * The balance a side can move, or `undefined` while unknown. A Bitcoin side spends from (or delivers to) the
 * Bound trading wallet, whose balance covers native BTC only, so a Rune there has no balance to show.
 */
function sideBalance(
  chainKey: SpokeChainKey,
  token: XToken | undefined,
  tradingBalance: { btcSatoshi: bigint } | undefined,
  balances: Record<string, bigint> | undefined,
): bigint | undefined {
  if (!token) return undefined;
  if (chainKey === ChainKeys.BITCOIN_MAINNET) {
    return isNativeToken(chainKey, token) ? tradingBalance?.btcSatoshi : undefined;
  }
  return balances?.[token.address];
}

/**
 * Bridge-api demo card — the existing on-chain bridge UI (chain/token selection, max-bridgeable,
 * route-availability gate) wired to the HTTP Bridge API (`sodax.api.bridge.*`) via the `bridgeApi/`
 * hooks, mirroring how the swaps-api demo wires swaps. Chains, tokens and the bridgeable limit come from the
 * API too, so the page offers every token the backend lists, including ones the installed SDK does not bundle.
 */
export default function BridgeCard({ setOrders }: { setOrders: (value: SetStateAction<BridgeApiOrder[]>) => void }) {
  const { sodax } = useSodaxContext();
  const { openWalletModal, sodaxSettings } = useAppStore();
  const bridgeApiBaseURL = effectiveBridgeApiBaseUrl(sodaxSettings);
  const bridgeApiConfig = useMemo((): RequestOverrideConfig => ({ baseURL: bridgeApiBaseURL }), [bridgeApiBaseURL]);

  const { data: apiTokens, isLoading: isLoadingBridgeableTokens } = useBridgeApiTokens({
    params: { apiConfig: bridgeApiConfig },
  });
  const supportedTokensPerChain = useMemo(
    () =>
      new Map(
        Object.entries(apiTokens ?? {}).map(([chainKey, tokens]) => [chainKey as SpokeChainKey, tokens.map(toXToken)]),
      ),
    [apiTokens],
  );
  const chainList = useMemo(() => [...supportedTokensPerChain.keys()], [supportedTokensPerChain]);

  const [fromChainKey, setFromChainKey] = useState<SpokeChainKey>(ChainKeys.BASE_MAINNET);
  const [toChainKey, setToChainKey] = useState<SpokeChainKey>(ChainKeys.POLYGON_MAINNET);

  // Picks are kept by symbol and resolved against the current chain's list, so a token never outlives its chain.
  const [fromSymbol, setFromSymbol] = useState<string | undefined>(undefined);
  const [toSymbol, setToSymbol] = useState<string | undefined>(undefined);
  const fromTokens = supportedTokensPerChain.get(fromChainKey) ?? [];
  const fromToken: XToken | undefined = fromTokens.find(t => t.symbol === fromSymbol) ?? fromTokens[0];
  const [fromAmount, setFromAmount] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  // A guarded token needs two signatures; one flat "Approving…" across both looks like a double charge.
  const [approvalProgress, setApprovalProgress] = useState<ApprovalProgress | null>(null);
  const [isBridging, setIsBridging] = useState(false);
  const [isFromBtcReady, setIsFromBtcReady] = useState(false);
  const [isToBtcReady, setIsToBtcReady] = useState(false);
  // Optional per-request partner fee (demo): a receiver address + fee percent (0.3 = 0.3%, max 1%).
  const feeDraft = usePartnerFeeDraft({ maxBps: BRIDGE_API_MAX_PARTNER_FEE_BPS });

  const fromAccount = useXAccount({ xChainId: fromChainKey });
  const toAccount = useXAccount({ xChainId: toChainKey });
  const disconnect = useXDisconnect();

  const sourceWalletProvider = useWalletProvider({ xChainId: fromChainKey });
  const toWalletProvider = useWalletProvider({ xChainId: toChainKey });
  const fromChainType = getXChainType(fromChainKey);
  const toChainType = getXChainType(toChainKey);

  // Destination tokens that share the source token's hub vault, the same rule as `sodax.bridge.getBridgeableTokens`.
  const bridgeableTokens = useMemo(() => {
    if (!fromToken) return [];
    const vault = fromToken.vault.toLowerCase();
    return (supportedTokensPerChain.get(toChainKey) ?? []).filter(t => t.vault.toLowerCase() === vault);
  }, [fromToken, toChainKey, supportedTokensPerChain]);
  const toToken: XToken | undefined = bridgeableTokens.find(t => t.symbol === toSymbol) ?? bridgeableTokens[0];

  // A listed pair can still have a zero limit, and then create-intent fails, so gate on the live limit.
  const {
    data: bridgeable,
    error: bridgeableError,
    isLoading: isLoadingBridgeableAmount,
  } = useBridgeApiBridgeableAmount({
    params: {
      body:
        fromToken && toToken
          ? {
              srcChainKey: fromChainKey,
              dstChainKey: toChainKey,
              inputToken: fromToken.address,
              outputToken: toToken.address,
            }
          : undefined,
      apiConfig: bridgeApiConfig,
    },
    // A rejected pair (400) is deterministic, so retrying only delays the answer.
    queryOptions: { retry: false },
  });
  const bridgeableAmount = bridgeable?.limit;
  const limitAmount = parseLimitAmount(bridgeableAmount?.amount);
  const isBridgeable = limitAmount !== undefined && limitAmount > 0n;

  const parsedAmount = useMemo(() => {
    if (!fromToken || !fromAmount) return undefined;
    try {
      return parseUnits(fromAmount, fromToken.decimals);
    } catch {
      return undefined;
    }
  }, [fromAmount, fromToken]);

  // Destination address (Bitcoin delivers to the Bound trading wallet, never the personal one).
  const recipient = useMemo(() => {
    if (!toAccount.address) return undefined;
    return toChainKey === ChainKeys.BITCOIN_MAINNET
      ? (loadRadfiSession(toAccount.address)?.tradingAddress ?? toAccount.address)
      : toAccount.address;
  }, [toChainKey, toAccount.address]);

  // Optional per-request partnerFee, seeded from Sodax Settings. Omit to use the backend default.
  const partnerFee = feeDraft.partnerFee;

  // The wire DTO sent to every Bridge API call (swaps naming; built from the client-side selection).
  const bridgeBody = useMemo((): CreateBridgeIntentParamsV2 | undefined => {
    if (!fromToken || !toToken || !fromAccount.address || !recipient || parsedAmount === undefined) return undefined;
    const body: CreateBridgeIntentParamsV2 = {
      srcChainKey: fromChainKey,
      dstChainKey: toChainKey,
      inputToken: fromToken.address,
      outputToken: toToken.address,
      inputAmount: parsedAmount.toString(),
      srcAddress: fromAccount.address,
      dstAddress: recipient,
    };
    // Bitcoin source via Bound TRADING: thread the access token so the backend can build the PSBT.
    if (fromChainType === 'BITCOIN') {
      const accessToken = loadRadfiSession(fromAccount.address)?.accessToken;
      if (accessToken) body.bound = { accessToken };
    }
    // Stacks source: the tx is built unsigned and a Stacks address can't yield the signer public key,
    // so it has to travel with the request (same extra the swaps showcase sends).
    if (fromChainType === 'STACKS' && fromAccount.publicKey) {
      body.srcPublicKey = fromAccount.publicKey;
    }
    // Per-request partner fee — routed to `partnerFee.address`; omit to use the backend-configured fee.
    if (partnerFee) body.partnerFee = partnerFee;
    return body;
  }, [
    fromToken,
    toToken,
    fromAccount.address,
    fromAccount.publicKey,
    recipient,
    parsedAmount,
    fromChainKey,
    toChainKey,
    fromChainType,
    partnerFee,
  ]);

  // Live fee quote via the HTTP API — shows the fee that will be charged for the current amount + partnerFee.
  const { data: feeQuote } = useBridgeApiFee({
    params: {
      body: parsedAmount !== undefined ? { inputAmount: parsedAmount.toString(), partnerFee } : undefined,
      apiConfig: bridgeApiConfig,
    },
  });

  // Net the recipient receives = input − fee: the bridge deducts the partner fee before withdrawing
  // (`withdrawAmount = translatedAmount - feeAmount`), so the destination gets the post-fee amount.
  const receiveAmount = useMemo(() => {
    if (parsedAmount === undefined || !fromToken) return fromAmount;
    const net = parsedAmount - (feeQuote ? BigInt(feeQuote.fee) : 0n);
    return net > 0n ? formatUnits(net, fromToken.decimals) : '0';
  }, [parsedAmount, fromToken, feeQuote, fromAmount]);

  const { data: allowance, isLoading: isAllowanceLoading } = useBridgeApiAllowance({
    // Gate the allowance body behind the review dialog (mirrors the swaps-api card, whose intent params
    // are undefined until the dialog builds them). The hook enables itself on `!!body`, so passing an
    // undefined body while the dialog is closed stops `checkAllowance` firing on every amount keystroke;
    // the amount is fixed once the dialog is open, so it runs once.
    params: { body: dialogOpen ? bridgeBody : undefined, apiConfig: bridgeApiConfig },
  });
  const hasAllowance = allowance?.valid === true;

  const { mutateAsyncSafe: approve } = useBridgeApiApproveAndBroadcast();
  const { mutateAsyncSafe: createBridgeIntent } = useBridgeApiCreateBridgeIntent();
  const { mutateAsyncSafe: submitTx } = useBridgeApiSubmitTx();

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: fromChainKey });

  // Client-side destination prerequisites the API doesn't cover: Stellar trustline + NEAR storage.
  const stellarWalletProvider =
    toChainType === 'STELLAR' ? (toWalletProvider as IStellarWalletProvider | undefined) : undefined;
  // Trustline capacity is denominated in the destination asset (Stellar works in stroops, 7dp), but
  // `parsedAmount` is in the source token's decimals — an 18dp source would overstate it by 1e11.
  const dstAmount = useMemo(
    () =>
      fromToken && toToken && parsedAmount !== undefined
        ? rescaleTokenAmount(parsedAmount, fromToken.decimals, toToken.decimals)
        : undefined,
    [parsedAmount, fromToken, toToken],
  );

  // Below the destination asset's smallest unit the rescale floors to `0n`, which the trustline
  // query reads as "no amount" and skips — leaving `needsTrustline` false and the prerequisite
  // unchecked. Reject the amount instead of gating on a query that never runs.
  const isBelowDestinationUnit = dstAmount === 0n && parsedAmount !== undefined && parsedAmount > 0n;

  const { data: hasSufficientTrustline, isPending: isTrustlineLoading } = useStellarTrustlineCheck({
    params: {
      token: toToken?.address,
      amount: isBelowDestinationUnit ? undefined : dstAmount,
      chainId: toChainKey,
      walletAddress: toChainType === 'STELLAR' ? toAccount.address : undefined,
    },
  });
  const { requestTrustline, isLoading: isRequestingTrustline } = useRequestTrustline(toToken?.address);

  const nearStorage = useNearStorageGate({
    dstChainKey: toChainKey,
    token: toToken?.address,
    accountId: toAccount.address,
    walletProvider: toWalletProvider,
  });

  const fromBtcAddress = fromChainKey === ChainKeys.BITCOIN_MAINNET ? fromAccount.address : undefined;
  const { data: fromBtcBalance } = useBitcoinBalance({ params: { address: fromBtcAddress } });
  const toBtcAddress = toChainKey === ChainKeys.BITCOIN_MAINNET ? toAccount.address : undefined;
  const { data: toBtcBalance } = useBitcoinBalance({ params: { address: toBtcAddress } });

  // Bitcoin trading setup — each side routes through a Bound Exchange (Radfi) trading wallet; the
  // hook is inert unless its chain is Bitcoin. Keyed on the chain, so it does not depend on the
  // wallet provider carrying a runtime `chainType`.
  const sourceBitcoin = useBitcoinTradingSetup({
    chainKey: fromChainKey,
    walletProvider: sourceWalletProvider,
    address: fromAccount.address,
  });
  const destBitcoin = useBitcoinTradingSetup({
    chainKey: toChainKey,
    walletProvider: toWalletProvider,
    address: toAccount.address,
  });

  // Wallet-layer reads: the Bridge API has no balance route. A Bitcoin side reads the trading wallet instead.
  const { data: fromBalances } = useBalances({
    params: {
      chainKey: fromChainKey,
      tokens: fromToken && fromChainKey !== ChainKeys.BITCOIN_MAINNET ? [fromToken] : [],
      address: fromAccount.address,
    },
  });
  const { data: toBalances } = useBalances({
    params: {
      chainKey: toChainKey,
      tokens: toToken && toChainKey !== ChainKeys.BITCOIN_MAINNET ? [toToken] : [],
      address: toAccount.address,
    },
  });
  const fromBalance = sideBalance(fromChainKey, fromToken, sourceBitcoin.tradingBalance, fromBalances);
  const toBalance = sideBalance(toChainKey, toToken, destBitcoin.tradingBalance, toBalances);

  const isSourceSignable = isSignableBridgeApiChain(fromChainKey) || fromChainType === 'BITCOIN';

  const handleOpenDialog = () => {
    setApproveError(null);
    setBridgeError(null);
    setDialogOpen(true);
  };

  const handleSwitch = () => {
    setFromChainKey(toChainKey);
    setToChainKey(fromChainKey);
    setFromSymbol(toToken?.symbol);
    setToSymbol(fromToken?.symbol);
    setFromAmount('');
  };

  const handleApprove = async (): Promise<void> => {
    if (!bridgeBody || !sourceWalletProvider) return;
    setApproveError(null);
    setIsApproving(true);
    try {
      // The hook owns plan → sign → broadcast → wait (stale-allowance reset included) and invalidates
      // the allowance query itself.
      const result = await approve({
        body: bridgeBody,
        walletProvider: sourceWalletProvider,
        apiConfig: bridgeApiConfig,
        onProgress: setApprovalProgress,
      });
      if (!result.ok) {
        setApproveError(formatMutationFailureMessage(result.error, 'Approve failed'));
        return;
      }
    } catch (error) {
      setApproveError(formatMutationFailureMessage(error, 'Approve signing failed'));
    } finally {
      setIsApproving(false);
      setApprovalProgress(null);
    }
  };

  const handleBridge = async (): Promise<void> => {
    if (!bridgeBody || !sourceWalletProvider || !fromAccount.address) return;
    setBridgeError(null);
    setIsBridging(true);
    try {
      // 1. The API builds the unsigned spoke-deposit tx + relay envelope.
      const created = await createBridgeIntent({ body: bridgeBody, apiConfig: bridgeApiConfig });
      if (!created.ok) {
        setBridgeError(formatMutationFailureMessage(created.error, 'Create bridge intent failed'));
        return;
      }
      const { tx, relayData } = created.value;

      // 2. Sign + broadcast on the source chain.
      let spokeTxHash: string;
      if (getXChainType(fromChainKey) === 'BITCOIN') {
        // Bitcoin uses a 2-of-2 Bound Exchange trading wallet: the user signs the Bound-built PSBT,
        // then Bound co-signs + broadcasts — routed through the SDK with the client's Bound session.
        const session = loadRadfiSession(fromAccount.address);
        if (!session?.accessToken) {
          setBridgeError('Bitcoin source requires a Bound Exchange trading wallet — sign in first.');
          return;
        }
        spokeTxHash = await sodax.spoke.getSpokeService(ChainKeys.BITCOIN_MAINNET).signAndSubmitRawTransaction({
          rawTx: tx as BitcoinRawTransaction,
          walletProvider: sourceWalletProvider as IBitcoinWalletProvider,
          // The Bridge API types relayData as plain strings; they are hex at runtime.
          relayData: { address: relayData.address as Hex, payload: relayData.payload as Hex },
          accessToken: session.accessToken,
        });
      } else {
        spokeTxHash = await signAndBroadcastBridgeApiTx({
          chainKey: fromChainKey,
          tx,
          walletProvider: sourceWalletProvider,
        });
      }

      // 3. Hand the tx back to the API for relay. The FULL relayData envelope is required (bridge has
      // no intent.creator for the backend to rebuild the relay address).
      const request: BridgeSubmitTxRequestV2 = {
        txHash: spokeTxHash,
        srcChainKey: fromChainKey,
        walletAddress: fromAccount.address,
        relayData,
      };
      const submitted = await submitTx({ request, apiConfig: bridgeApiConfig });
      if (!submitted.ok) {
        setBridgeError(formatMutationFailureMessage(submitted.error, 'Submit tx failed'));
        return;
      }

      setOrders(prev => [...prev, { txHash: spokeTxHash, srcChainKey: fromChainKey, apiBaseURL: bridgeApiBaseURL }]);
      setDialogOpen(false);
    } catch (error) {
      setBridgeError(formatMutationFailureMessage(error, 'Bridge signing failed'));
    } finally {
      setIsBridging(false);
    }
  };

  const handleRequestTrustline = async () => {
    if (toChainType !== 'STELLAR' || !stellarWalletProvider || !toToken || !dstAmount) return;
    await requestTrustline({
      token: toToken.address,
      amount: dstAmount,
      srcChainKey: toChainKey as StellarChainKey,
      walletProvider: stellarWalletProvider,
    });
  };

  const handleRegisterNearStorage = async () => {
    const result = await nearStorage.registerStorage();
    if (result && !result.ok) {
      setBridgeError(formatMutationFailureMessage(result.error, 'Storage registration failed'));
    }
  };

  const needsTrustline = toChainType === 'STELLAR' && !isTrustlineLoading && !hasSufficientTrustline;
  const isBridgeDisabled =
    isBridging ||
    !bridgeBody ||
    !!feeDraft.error ||
    isBelowDestinationUnit ||
    (fromChainType === 'EVM' && !hasAllowance) ||
    (fromChainKey === ChainKeys.BITCOIN_MAINNET && !isFromBtcReady) ||
    (toChainKey === ChainKeys.BITCOIN_MAINNET && !isToBtcReady) ||
    needsTrustline ||
    nearStorage.blocksAction;

  return (
    <>
      <Card className="w-full max-w-lg mx-auto">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl font-bold text-center">Cross-Chain Transfer (API)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>From</Label>
            <ChainSelector selectedChainId={fromChainKey} selectChainId={setFromChainKey} allowedChains={chainList} />
          </div>

          <div className="flex space-x-2">
            <div className="grow">
              <Input type="number" placeholder="0.0" value={fromAmount} onChange={e => setFromAmount(e.target.value)} />
            </div>
            <SelectToken
              tokens={fromTokens}
              value={fromToken?.symbol}
              onSelect={t => setFromSymbol(t.symbol)}
              className="w-[110px]"
            />
          </div>

          <div className="text-sm text-muted-foreground flex gap-1">
            <span>Balance:</span>
            <span>{fromBalance === undefined ? '—' : formatTokenAmount(fromBalance, fromToken?.decimals ?? 0, 5)}</span>
          </div>

          {isBelowDestinationUnit && toToken && (
            <p className="text-sm text-red-500">
              Amount is below the smallest {toToken.symbol} unit on {toChainKey} — bridge at least{' '}
              {formatUnits(1n, toToken.decimals)}.
            </p>
          )}

          <div className="grow">
            <PartnerFeeFields draft={feeDraft} unsetBehavior="use the backend's configured fee" />
            {feeQuote && fromToken ? (
              <p className="mt-1 text-xs text-muted-foreground wrap-anywhere">
                Fee: {formatUnits(BigInt(feeQuote.fee), fromToken.decimals)} {fromToken.symbol}
                {partnerFee ? ` → ${partnerFee.address}` : ' (backend default)'}
              </p>
            ) : null}
          </div>

          <div className="grow">
            <Label htmlFor="fromAddress">Source address</Label>
            <div className="flex items-center gap-2">
              <Input id="fromAddress" type="text" value={fromAccount.address ?? ''} disabled />
              {fromAccount.address ? (
                <Button onClick={() => fromChainType && disconnect({ xChainType: fromChainType })}>Disconnect</Button>
              ) : (
                <Button onClick={openWalletModal}>Connect</Button>
              )}
            </div>
          </div>

          {/* A Bitcoin source spends from the Bound trading wallet, so funding it is a precondition for
              bridging at all — not a confirmation step. Each panel sits with the side it belongs to. */}
          {sourceBitcoin.wallet && (
            <BitcoinSetupPanel
              walletProvider={sourceBitcoin.wallet}
              onReadyChange={setIsFromBtcReady}
              nativeBalance={fromBtcBalance}
            />
          )}

          <div className="flex justify-center">
            <Button variant="outline" size="icon" onClick={handleSwitch}>
              <ArrowDownUp className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label>To</Label>
            <ChainSelector selectedChainId={toChainKey} selectChainId={setToChainKey} allowedChains={chainList} />
          </div>

          <div className="flex space-x-2">
            <div className="grow">
              <Input type="number" placeholder="0.0" value={receiveAmount} readOnly />
            </div>
            {isLoadingBridgeableTokens ? (
              <Skeleton className="w-[110px] h-10" />
            ) : (
              <SelectToken
                tokens={bridgeableTokens}
                value={toToken?.symbol}
                onSelect={t => setToSymbol(t.symbol)}
                className="w-[110px]"
              />
            )}
          </div>

          <div className="text-sm text-muted-foreground flex gap-1">
            <span>Balance:</span>
            <span>{toBalance === undefined ? '—' : formatTokenAmount(toBalance, toToken?.decimals ?? 0, 5)}</span>
          </div>

          <div className="grow">
            <Label htmlFor="toAddress">Destination address</Label>
            <div className="flex items-center gap-2">
              <Input id="toAddress" type="text" value={recipient ?? ''} disabled />
              {toAccount.address ? (
                <Button onClick={() => toChainType && disconnect({ xChainType: toChainType })}>Disconnect</Button>
              ) : (
                <Button onClick={openWalletModal}>Connect</Button>
              )}
            </div>
          </div>

          {destBitcoin.wallet && (
            <BitcoinSetupPanel
              walletProvider={destBitcoin.wallet}
              onReadyChange={setIsToBtcReady}
              nativeBalance={toBtcBalance}
              isDestination
            />
          )}
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          {isLoadingBridgeableAmount ? (
            <Skeleton className="w-48 h-5" />
          ) : isBridgeable && bridgeableAmount && limitAmount !== undefined ? (
            <div className="flex items-center gap-2 text-sm">
              Maximum bridgeable:{' '}
              {Number.parseFloat(formatUnits(limitAmount, bridgeableAmount.decimals)).toLocaleString('en-US')}{' '}
              {toToken?.symbol} ({bridgeableAmount.type === 'DEPOSIT_LIMIT' ? 'deposit' : 'withdraw'} limit)
            </div>
          ) : bridgeableError ? (
            <div className="text-sm text-destructive">
              {formatMutationFailureMessage(bridgeableError, 'Could not load the bridge limit')}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Route not available</div>
          )}
          <Button
            className="w-full"
            onClick={handleOpenDialog}
            disabled={!bridgeBody || !isBridgeable || !isSourceSignable || !!feeDraft.error || isBelowDestinationUnit}
          >
            Bridge
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={isOpen => !isOpen && setDialogOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bridge Order</DialogTitle>
            <DialogDescription>Review and confirm your cross-chain transfer (via the Bridge API).</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <div>
              From: {fromToken?.symbol} on {fromChainKey}
            </div>
            <div>
              To: {toToken?.symbol} on {toChainKey}
            </div>
            <div>Amount: {fromToken ? formatUnits(parsedAmount ?? 0n, fromToken.decimals) : fromAmount}</div>
            <div className="break-all">Recipient: {recipient}</div>

            {needsTrustline && (
              <div className="text-red-500">Insufficient Stellar trustline — request trustline to proceed.</div>
            )}
            {nearStorage.needsRegistration && (
              <div className="text-red-500">
                Recipient is not storage-registered for this token on NEAR — register storage to proceed.
              </div>
            )}
          </div>

          {(approveError ?? bridgeError) && (
            <div className="text-red-500 text-sm space-y-1 wrap-anywhere">
              {approveError ? <div>{approveError}</div> : null}
              {bridgeError ? <div>{bridgeError}</div> : null}
            </div>
          )}

          <DialogFooter className="flex flex-col gap-2 sm:flex-col">
            {fromChainType === 'EVM' && (
              <Button
                className="w-full"
                onClick={handleApprove}
                disabled={isAllowanceLoading || hasAllowance || isApproving}
              >
                {isApproving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />{' '}
                    {(approvalProgress && approvalStepLabel(approvalProgress)) ?? 'Approving…'}
                  </>
                ) : hasAllowance ? (
                  'Approved'
                ) : (
                  'Approve'
                )}
              </Button>
            )}

            {toChainType === 'STELLAR' && isTrustlineLoading && <span className="text-sm">Checking trustline…</span>}

            {needsTrustline && (
              <Button className="w-full" onClick={handleRequestTrustline} disabled={isRequestingTrustline}>
                {isRequestingTrustline ? 'Requesting…' : 'Request Trustline'}
              </Button>
            )}

            {nearStorage.isNear && (nearStorage.isChecking || nearStorage.needsRegistration) && (
              <Button
                className="w-full"
                onClick={handleRegisterNearStorage}
                disabled={nearStorage.isChecking || nearStorage.isRegistering}
              >
                {nearStorage.isChecking ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking storage…
                  </>
                ) : nearStorage.isRegistering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Registering…
                  </>
                ) : (
                  'Register Storage'
                )}
              </Button>
            )}

            {isWrongChain && fromChainType === 'EVM' && (
              <Button className="w-full" onClick={handleSwitchChain}>
                Switch Chain
              </Button>
            )}

            {!isWrongChain && (
              <Button className="w-full" onClick={handleBridge} disabled={isBridgeDisabled}>
                {isBridging ? (
                  'Bridging…'
                ) : (
                  <>
                    <ArrowLeftRight className="mr-2 h-4 w-4" /> Bridge
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
