/**
 * Leverage Yield demo page — swap-style deposit/withdraw.
 *
 * Treats lsoda* tokens (leverage-vault shares) as just-another-tradeable-token via the
 * Sodax solver. So:
 *   - Deposit  = swap (any token, any chain) → lsoda* on Sonic
 *   - Withdraw = swap lsoda* on Sonic → (any token, any chain)
 *
 * No bespoke leverage-yield orchestration needed — the solver routes through whichever
 * AMM has lsoda* liquidity. Legacy `xdeposit`/`xwithdraw` SDK methods still exist for
 * direct deposit/withdraw against the vault.asset() but aren't exposed here.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { fmtBps, fmtHealthFactor } from '@/lib/utils';
import {
  useLeverageYieldQuote,
  useSodaxContext,
  useSwapAllowance,
  useSwapApprove,
  useBalances,
  useLeverageYieldDeposit,
  useLeverageYieldVaultSwap,
  useLeverageYieldWithdraw,
  useLeverageYieldEffectiveApr,
  useLeverageYieldPosition,
  useLeverageYieldTotalAssets,
  useLeverageYieldPreviewRedeem,
  useLeverageYieldShareBalances,
  ChainKeys,
  getSupportedSolverTokens,
  type LeverageYieldQuoteParams,
  type LeverageYieldSwapPayload,
  type LeverageYieldVault,
  type PartnerFee,
  type SpokeChainKey,
  type XToken,
} from '@sodax/dapp-kit';
import {
  getXChainType,
  useEvmSwitchChain,
  useWalletProvider,
  useXAccount,
  useXAccounts,
} from '@sodax/wallet-sdk-react';
import { type FinalStatus, type Order, buildOrderSummary, orderId } from '@/components/swaps/OrderStatus';
import OrderStatusPanel from '@/components/swaps/OrderStatusPanel';
import { LEVERAGE_YIELD_ORDERS_KEY, appendOrder, loadOrders, saveOrders } from '@/lib/orderHistory';
import { LEVERAGE_YIELD_PANEL_KEY } from '@/lib/panelPrefs';
import BigNumber from 'bignumber.js';
import { useQueryClient } from '@tanstack/react-query';
import { formatUnits, parseUnits } from 'viem';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';

const SONIC = ChainKeys.SONIC_MAINNET satisfies SpokeChainKey;
const DEFAULT_SLIPPAGE = '0.5'; // %

// Per-intent partner fee on leverage-vault DEPOSITS (10 bps = 0.1%). Passed to both the quote and the
// deposit builder; withdraws use the configured leverage-yield fee (`leverageYield.partnerFee ?? fee`).
const DEPOSIT_PARTNER_FEE = {
  address: '0x93D5CE288b3BF6b33F913b98FD1fA844Acc462d4',
  percentage: 10,
} as const satisfies PartnerFee;

function fmtUnits(value: bigint | undefined, decimals: number, digits = 6): string {
  if (value === undefined || value === null) return '—';
  const s = formatUnits(value, decimals);
  const [int, frac = ''] = s.split('.');
  return `${int}.${frac.slice(0, digits).padEnd(digits, '0')}`;
}

/**
 * Format an AAVE-style RAY rate (1e27 = 100%) as a percentage string. Handles negative
 * net APRs (when leverage × borrow exceeds 1 × supply) — sign survives the bigint→number
 * conversion via the explicit negative branch.
 */
function fmtApr(rateRay: bigint | undefined, digits = 2): string {
  if (rateRay === undefined) return '—';
  // 1e27 → 1.0 = 100%. Convert to percentage: rate × 100 / 1e27 = rate / 1e25.
  // Do the divide in bigint to avoid number-precision loss, then format.
  const SCALE = 100_000n; // keep 5 fractional digits for safety
  const sign = rateRay < 0n ? -1n : 1n;
  const abs = rateRay < 0n ? -rateRay : rateRay;
  // (abs × 100 × SCALE) / 1e27, then back to decimal
  const pctScaled = (abs * 100n * SCALE) / 10n ** 27n;
  const num = Number(sign * pctScaled) / Number(SCALE);
  return `${num.toFixed(digits)}%`;
}

/** Format a WAD-scaled (1e18) leverage multiplier as `5.67`. */
function fmtLeverage(multWad: bigint | undefined, digits = 2): string {
  if (multWad === undefined) return '—';
  const SCALE = 100_000n;
  const scaled = (multWad * SCALE) / 1_000_000_000_000_000_000n;
  return (Number(scaled) / Number(SCALE)).toFixed(digits);
}

export default function LeverageYieldPage() {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  const { openWalletModal, solverEnvironment, setSolverEnvironment, sodaxSettings } = useAppStore();

  // ─── Vault selection ─────────────────────────────────────────────────────

  const vaults = useMemo(() => sodax.leverageYield.listVaults(), [sodax]);
  const [selectedVaultName, setSelectedVaultName] = useState<string>(vaults[0]?.name ?? '');
  const selectedVault: LeverageYieldVault | undefined = useMemo(
    () => vaults.find(v => v.name === selectedVaultName),
    [vaults, selectedVaultName],
  );

  // The lsoda* XToken on Sonic that matches this vault's proxy address. This is the
  // "locked" side of the swap UI — destination on deposit, source on withdraw.
  const lsodaToken: XToken | undefined = useMemo(() => {
    if (!selectedVault) return undefined;
    const sonicTokens = getSupportedSolverTokens(SONIC);
    return sonicTokens.find(t => t.address.toLowerCase() === selectedVault.vault.toLowerCase());
  }, [selectedVault]);

  // ─── Single-side state ──────────────────────────────────────────────────
  // The user only connects ONE wallet (their spoke chain) and picks ONE token. The
  // counterparty token is implicit:
  //   - Deposit:  user-picked token → lsoda* (in their hub wallet)
  //   - Withdraw: lsoda* (from hub wallet) → user-picked token
  // No Sonic wallet connection needed for either flow — the hub wallet is derived
  // deterministically from (userChain, userAddress).

  const supportedSpokeChains = useMemo(() => sodax.config.getSupportedSpokeChains(), [sodax]);
  const [userChain, setUserChain] = useState<SpokeChainKey>(ChainKeys.ARBITRUM_MAINNET);
  const userTokens = useMemo(() => getSupportedSolverTokens(userChain), [userChain]);
  // Store the SYMBOL and derive the token during render. Holding the token in its own state and
  // re-resolving it from an effect left one committed render pairing the new `userChain` with the
  // previous chain's token — a mismatch `useBalances` reads as `0n` instead of rejecting, so it
  // surfaces as a phantom empty balance. Deriving from `userTokens`, which recomputes in the same
  // render as `userChain`, closes that window.
  const [userTokenSymbol, setUserTokenSymbol] = useState<string | undefined>(userTokens[0]?.symbol);
  const userToken = useMemo(
    () => userTokens.find(t => t.symbol === userTokenSymbol) ?? userTokens[0],
    [userTokens, userTokenSymbol],
  );

  // ─── Active tab ──────────────────────────────────────────────────────────

  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');

  // src/dst derivation — single user-picked side, the other is implicitly lsoda* on hub.
  // Deposit:  user pays `userToken` on `userChain` → receives `lsodaToken` on Sonic.
  // Withdraw: user burns `lsodaToken` on Sonic → receives `userToken` on `userChain`.
  const src = tab === 'deposit' ? { chain: userChain, token: userToken } : { chain: SONIC, token: lsodaToken };
  const dst = tab === 'deposit' ? { chain: SONIC, token: lsodaToken } : { chain: userChain, token: userToken };

  // ─── Wallet (single — the user's spoke chain) ────────────────────────────
  // Same EOA holds the source funds on deposit AND receives the swap output on withdraw.
  // No dst wallet connection required: dst address is derived (deposit → hub wallet;
  // withdraw → same EOA on `userChain`).

  const userAccount = useXAccount({ xChainId: userChain });
  const userWalletProvider = useWalletProvider({ xChainId: userChain });
  const userChainType = getXChainType(userChain);
  const { isWrongChain: isUserWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: userChain });
  const showEvmSwitch = userChainType === 'EVM' && isUserWrongChain && !!userAccount.address;

  // Aliases — handleSwap and friends were written against src.*; keep them working.
  const sourceAccount = userAccount;
  const sourceWalletProvider = userWalletProvider;

  // ─── Balances (single — user's token on user chain) ──────────────────────

  const { data: userBalances } = useBalances({
    params: {
      chainKey: userChain,
      tokens: userToken ? [userToken] : [],
      address: userAccount.address,
    },
  });
  const userBalance: bigint | undefined = userToken ? userBalances?.[userToken.address] : undefined;

  // ─── Amount + quote ──────────────────────────────────────────────────────

  const [sourceAmount, setSourceAmount] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);

  // Reset amount + intent when tab/vault/chain/token changes — stale quotes are confusing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional reset triggers, not values read in the effect
  useEffect(() => {
    setSourceAmount('');
    setIntentOrderPayload(undefined);
  }, [tab, selectedVaultName, userChain, userToken?.address]);

  // Gross amount: the leverage-yield quote deducts the same fee the vault intent charges.
  const quotePayload: LeverageYieldQuoteParams | undefined = useMemo(() => {
    if (!src.token || !dst.token || Number(sourceAmount) <= 0) return undefined;
    return {
      token_src: src.token.address,
      token_src_blockchain_id: src.chain,
      token_dst: dst.token.address,
      token_dst_blockchain_id: dst.chain,
      amount: parseUnits(sourceAmount, src.token.decimals),
      quote_type: 'exact_input',
      ...(tab === 'deposit' ? { partnerFee: DEPOSIT_PARTNER_FEE } : {}),
    } satisfies LeverageYieldQuoteParams;
  }, [src.token, dst.token, src.chain, dst.chain, sourceAmount, tab]);

  const quoteQuery = useLeverageYieldQuote({ params: { payload: quotePayload } });
  const quote = quoteQuery.data?.ok ? quoteQuery.data.value : undefined;

  const exchangeRate = useMemo(() => {
    if (!quote?.quoted_amount || !sourceAmount || !dst.token) return undefined;
    const out = new BigNumber(formatUnits(quote.quoted_amount, dst.token.decimals));
    const inp = new BigNumber(sourceAmount);
    if (inp.isZero()) return undefined;
    return out.div(inp);
  }, [quote, sourceAmount, dst.token]);

  const minOutputAmount: bigint | undefined = useMemo(() => {
    if (!quote?.quoted_amount) return undefined;
    return BigInt(
      new BigNumber(quote.quoted_amount)
        .multipliedBy(new BigNumber(100).minus(new BigNumber(slippage || '0')))
        .div(100)
        .toFixed(0),
    );
  }, [quote, slippage]);

  // ─── Intent payload + allowance + swap mutations ─────────────────────────

  const [intentOrderPayload, setIntentOrderPayload] = useState<LeverageYieldSwapPayload | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);

  // Withdraw skips the spoke-side allowance/approve: the [approve, createIntent] pair
  // is encoded into the sendMessage payload and the hub wallet executes it on Sonic.
  const { data: hasAllowance, isLoading: isAllowanceLoading } = useSwapAllowance({
    params: {
      payload: tab === 'deposit' ? intentOrderPayload?.params : undefined,
      srcChainKey: src.chain,
      walletProvider: sourceWalletProvider,
    },
  });

  const { mutateAsyncSafe: approve, isPending: isApproving } = useSwapApprove();
  const { mutateAsync: vaultSwap, isPending: isSwapping } = useLeverageYieldVaultSwap();

  // Leverage-yield intent builders. `mutateAsyncSafe` returns `Result<LeverageYieldSwapPayload>`
  // and never rejects, so `prepare()` branches on `.ok` exactly like the SDK's own builder did.
  const { mutateAsyncSafe: buildDepositIntent } = useLeverageYieldDeposit();
  const { mutateAsyncSafe: buildWithdrawIntent } = useLeverageYieldWithdraw();

  // ─── Shares across ALL connected chains' hub wallets ─────────────────────
  // Users may hold shares under multiple hub wallets — one per spoke chain they
  // deposited from. Enumerate every spoke chain that currently has a connected wallet
  // (per ChainType: EVM connection covers all EVM spoke chains; non-EVM map 1:1).
  // For each, the holder address is the user's EOA on Sonic, or the CREATE3-derived
  // hub wallet otherwise. Fetch share balances in parallel.
  const xAccounts = useXAccounts();
  const connectedHolders = useMemo(() => {
    return supportedSpokeChains
      .map(chainKey => {
        const chainType = getXChainType(chainKey);
        if (!chainType) return null;
        const address = xAccounts[chainType]?.address;
        return address ? { chainKey, address: address as string } : null;
      })
      .filter((x): x is { chainKey: SpokeChainKey; address: string } => x !== null);
  }, [supportedSpokeChains, xAccounts]);

  const sharesByChain = useLeverageYieldShareBalances({
    params: { vault: selectedVault?.vault, holders: connectedHolders },
  });

  // Holder + share balance for the currently-selected userChain — used by deposit
  // dstAddress, withdraw MAX/validation, and the inline withdraw display.
  const currentHolder = useMemo(
    () => sharesByChain.find(q => q.data?.chainKey === userChain)?.data,
    [sharesByChain, userChain],
  );
  const userShares: bigint | undefined = currentHolder?.shares;

  // Sum across all chains — single headline number for the user's total position.
  const totalShares: bigint = useMemo(
    () => sharesByChain.reduce((acc, q) => acc + (q.data?.shares ?? 0n), 0n),
    [sharesByChain],
  );

  // Effective APR — AAVE rates + LSD staking yield combined, with the leverage formula
  // re-applied on the boosted supply side. Single SDK call that does the on-chain reads
  // (AAVE supply/borrow + vault targetLTV) and the off-chain LSD fetch (Lido live; EtherFi
  // hardcoded fallback per the @sodax/types registry) in parallel. 60s refresh: AAVE rates
  // drift slowly and LSD APRs are 7-day MAs, so a headline number doesn't need finer.
  const { data: vaultApr } = useLeverageYieldEffectiveApr({ params: { vault: selectedVault?.vault } });

  // Vault TVL + share price. `previewRedeem(1e18)` = "1 share → N underlying" — the
  // per-share yield indicator that creeps up as the vault accrues interest. TVL is the
  // scale signal. 60s refresh: both move slowly.
  const { data: vaultTvl } = useLeverageYieldTotalAssets({ params: { vault: selectedVault?.vault } });
  const { data: vaultSharePrice } = useLeverageYieldPreviewRedeem({
    params: { vault: selectedVault?.vault, shares: 10n ** 18n },
  });
  const vaultStats =
    vaultTvl !== undefined && vaultSharePrice !== undefined
      ? { tvl: vaultTvl, sharePrice: vaultSharePrice }
      : undefined;

  // Live position snapshot — actual LTV (drift vs `targetLTV`), health factor
  // (liquidation safety, ∞ when no debt), idleAsset (capital not yet deployed).
  // 30s refresh: faster than APR since LTV shifts with each rebalance/rate tick.
  const { data: vaultPosition } = useLeverageYieldPosition({ params: { vault: selectedVault?.vault } });

  // Accumulated orders — each tracks its vault swap through <OrderStatus>, which reads the status
  // router, so it answers whether the backend submit-tx path or the relay fallback carried the swap.
  // Own localStorage key (separate from the solver page) since this is a different feature.
  const [orders, setOrders] = useState<Order[]>(() => loadOrders(LEVERAGE_YIELD_ORDERS_KEY));

  useEffect(() => {
    saveOrders(LEVERAGE_YIELD_ORDERS_KEY, orders);
  }, [orders]);

  // Cache a swap's terminal status so it stops polling once SOLVED/FAILED (same as the solver page).
  const handleSettleOrder = useCallback((id: string, final: FinalStatus) => {
    setOrders(prev => prev.map(order => (orderId(order) === id ? { ...order, final } : order)));
  }, []);

  const handleDismissOrder = (id: string) => {
    setOrders(prev => prev.filter(order => orderId(order) !== id));
  };

  // Resets the form and refreshes balances after a successful submit. Invalidates rather
  // than waits — the share balance won't move until the solver fills (seconds-to-minutes),
  // but invalidating now means the next read picks up any state shift instead of cached zeros.
  const resetAfterSubmit = () => {
    setSourceAmount('');
    setIntentOrderPayload(undefined);
    queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    queryClient.invalidateQueries({ queryKey: ['shared', 'balances'] });
  };

  // Builds the swap payload via the SDK's leverage-yield builders, then stashes it for
  // `handleSwap`. Deposit (any token → lsoda*) and withdraw (lsoda* → any token) both
  // produce an action-shaped `LeverageYieldSwapPayload` spread into the one
  // `leverageYield.vaultSwap()` path — withdraw's payload carries `hubWalletSwap: true`
  // so the vault swap routes via the hub wallet internally.
  const prepare = async () => {
    setActionError(null);
    if (
      !src.token ||
      !dst.token ||
      !sourceAccount.address ||
      !selectedVault ||
      !quote ||
      minOutputAmount === undefined
    ) {
      setActionError('Missing wallet, token, or quote — connect your chain and enter an amount.');
      return;
    }
    const inputAmount = parseUnits(sourceAmount, src.token.decimals);
    const result = await (tab === 'deposit'
      ? buildDepositIntent({
          vault: selectedVault.vault,
          srcChainKey: userChain,
          srcAddress: sourceAccount.address,
          inputToken: src.token.address,
          inputAmount,
          minOutputAmount,
          partnerFee: DEPOSIT_PARTNER_FEE,
        })
      : buildWithdrawIntent({
          vault: selectedVault.vault,
          srcChainKey: userChain,
          srcAddress: sourceAccount.address,
          dstChainKey: dst.chain,
          outputToken: dst.token.address,
          inputAmount,
          minOutputAmount,
        }));
    if (!result.ok) {
      setActionError(`Failed to build intent: ${result.error instanceof Error ? result.error.message : 'unknown'}`);
      return;
    }
    setIntentOrderPayload(result.value);
  };

  const handleApprove = async () => {
    if (!intentOrderPayload || !sourceWalletProvider) return;
    setActionError(null);
    const result = await approve({ params: intentOrderPayload.params, walletProvider: sourceWalletProvider });
    if (!result.ok) setActionError(result.error instanceof Error ? result.error.message : 'Approve failed');
  };

  /**
   * Executes the prepared intent. Tab-agnostic — the action-shaped `intentOrderPayload`
   * already encodes deposit vs withdraw (withdraw carries `hubWalletSwap: true`, handled
   * inside `vaultSwap()` / `createVaultIntent()`), so it spreads into either call
   * unchanged.
   *
   * One call, whichever transport is configured. `leverageYield.useBackendSubmitTx` (Sodax
   * Settings → Leverage Yield SDK) decides inside `vaultSwap()` whether the broadcast intent
   * goes to the leverage-yield API or is relayed client-side, and either way the resolved value
   * is the same `VaultSwapResponse` — so the order always renders in 'solver' mode. This page
   * used to own that choice itself and POST to the *swaps* submit-tx route, which meant a vault
   * swap submitted without its `operation` discriminator and with no relay fallback.
   */
  const handleSwap = async () => {
    if (!intentOrderPayload || !sourceWalletProvider) return;
    setActionError(null);

    // "AMOUNT TOKEN (NETWORK) => AMOUNT TOKEN (NETWORK)" snapshot for the order card.
    const summary = buildOrderSummary(src, dst, sourceAmount, quote?.quoted_amount);

    try {
      const { solverExecutionResponse, intent, intentDeliveryInfo } = await vaultSwap({
        ...intentOrderPayload,
        walletProvider: sourceWalletProvider,
        // Per-action key from Sodax Settings; omitted entirely when unset, so the backend legs fall
        // back to the instance key rather than being handed an empty credential.
        ...(sodaxSettings.leverageYieldApiKey ? { extras: { apiKey: sodaxSettings.leverageYieldApiKey } } : {}),
      });
      setOrders(prev =>
        appendOrder(prev, {
          mode: 'solver',
          intentHash: solverExecutionResponse.intent_hash,
          orderId: intent.intentId.toString(),
          dstTxHash: intentDeliveryInfo.dstTxHash as string,
          srcTxHash: intentDeliveryInfo.srcTxHash,
          srcChainKey: intentDeliveryInfo.srcChainKey,
          statusEndpoint: sodax.config.solver.solverApiEndpoint,
          createdAt: Date.now(),
          summary,
        }),
      );
      resetAfterSubmit();
    } catch (e) {
      setActionError(`Swap failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!selectedVault || !lsodaToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-lg mx-auto">
          <CardHeader>
            <CardTitle>Leverage Yield</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              {vaults.length === 0
                ? 'No leverage vaults registered in @sodax/types.'
                : "Selected vault's share token isn't in the swap registry — add it to LsodaTokens in @sodax/types."}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Aggregate load/error/empty status across the per-chain share queries (one row each above).
  const renderSharesStatus = () => {
    const loading = sharesByChain.filter(q => q.isLoading).length;
    const errored = sharesByChain.filter(q => q.isError).length;
    const resolved = sharesByChain.filter(q => q.data !== undefined).length;
    const nonZero = sharesByChain.filter(q => (q.data?.shares ?? 0n) > 0n).length;
    if (loading > 0) {
      return (
        <div className="text-xs text-muted-foreground">
          loading {loading} of {sharesByChain.length} chains…
        </div>
      );
    }
    if (errored > 0) {
      return (
        <div className="text-xs text-amber-600">
          {errored} of {sharesByChain.length} chains failed to load (likely CORS — check console)
        </div>
      );
    }
    if (resolved === sharesByChain.length && nonZero === 0) {
      return <div className="text-xs text-muted-foreground">no shares on any connected chain</div>;
    }
    return null;
  };

  return (
    <div className="flex flex-col items-center justify-start min-h-screen p-4 pt-8 pb-12 gap-4">
      {/* Swap history — fixed left sidebar on xl, in-flow below on smaller screens, same as /solver. */}
      <OrderStatusPanel
        orders={orders}
        onDismiss={handleDismissOrder}
        onSettle={handleSettleOrder}
        storageKey={LEVERAGE_YIELD_PANEL_KEY}
        feature="leverage-yield"
      />

      {/* Solver-environment switcher — same control as on /solver. Drives `solverEnvironment`
          in the app store; providers.tsx remaps the SDK's solver config on change. */}
      <Tabs value={solverEnvironment} onValueChange={v => setSolverEnvironment(v as SolverEnv)}>
        <TabsList>
          <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
          <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="w-full max-w-xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Leverage Yield</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Vault</Label>
            <Select value={selectedVaultName} onValueChange={setSelectedVaultName}>
              <SelectTrigger>
                <SelectValue placeholder="Select a vault" />
              </SelectTrigger>
              <SelectContent>
                {vaults.map(v => (
                  <SelectItem key={v.name} value={v.name}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground space-y-0.5 break-all">
              <div>
                vault: <code>{selectedVault.vault}</code>
              </div>
              <div>
                asset: <code>{selectedVault.asset}</code>
              </div>
              <div>
                borrowToken: <code>{selectedVault.borrowToken}</code>
              </div>
            </div>

            {/* Steady-state APR — leveraged spread between the supply side (AAVE supply
                rate + LSD staking yield) and the borrow side, scaled by the vault's
                targetLTV. The "Net APR" headline is the *effective* rate including the
                LSD's native staking yield (the dominant component for LSD-backed vaults);
                AAVE-only rows below show the math behind it. */}
            {vaultApr && (
              <div className="border-t pt-3 grid grid-cols-2 gap-y-1 text-sm">
                <span className="text-muted-foreground">Net APR</span>
                <span className="text-right font-mono text-base font-semibold">
                  {fmtApr(vaultApr.effectiveNetAprRay)}
                </span>
                {vaultApr.lsdApr.aprRay > 0n && (
                  <>
                    <span className="text-xs text-muted-foreground">
                      LSD staking {vaultApr.lsdApr.stale ? '(estimate)' : ''}
                    </span>
                    <span className="text-right font-mono text-xs">+{fmtApr(vaultApr.lsdApr.aprRay)}</span>
                  </>
                )}
                <span className="text-xs text-muted-foreground">AAVE supply ({selectedVault.asset.slice(0, 6)}…)</span>
                <span className="text-right font-mono text-xs">{fmtApr(vaultApr.supplyAprRay)}</span>
                <span className="text-xs text-muted-foreground">
                  AAVE borrow ({selectedVault.borrowToken.slice(0, 6)}…)
                </span>
                <span className="text-right font-mono text-xs">{fmtApr(vaultApr.borrowAprRay)}</span>
                <span className="text-xs text-muted-foreground">target leverage</span>
                <span className="text-right font-mono text-xs">{fmtLeverage(vaultApr.leverageMultiplierWad)}×</span>
                <span className="text-xs text-muted-foreground">AAVE-only net</span>
                <span className="text-right font-mono text-xs">{fmtApr(vaultApr.netAprRay)}</span>
              </div>
            )}

            {/* Vault scale + live position — TVL and share price answer "how big / how
                productive is this vault", the position block answers "is it safe right
                now". Actual LTV next to target shows drift; HF goes ∞ when there's no
                debt; idleAsset shows un-deployed capital that's not earning leverage. */}
            {(vaultStats || vaultPosition) && (
              <div className="border-t pt-3 grid grid-cols-2 gap-y-1 text-sm">
                {vaultStats && (
                  <>
                    <span className="text-muted-foreground">TVL</span>
                    <span className="text-right font-mono">
                      {fmtUnits(vaultStats.tvl, 18)} {selectedVault.asset.slice(0, 6)}…
                    </span>
                    <span className="text-xs text-muted-foreground">share price (1 share →)</span>
                    <span className="text-right font-mono text-xs">{fmtUnits(vaultStats.sharePrice, 18, 8)}</span>
                  </>
                )}
                {vaultPosition && vaultApr && (
                  <>
                    <span className="text-xs text-muted-foreground">current LTV (target)</span>
                    <span className="text-right font-mono text-xs">
                      {fmtBps(vaultPosition.ltv)} ({fmtBps(vaultApr.targetLtvBps)})
                    </span>
                    <span className="text-xs text-muted-foreground">health factor</span>
                    <span className="text-right font-mono text-xs">{fmtHealthFactor(vaultPosition.healthFactor)}</span>
                    <span className="text-xs text-muted-foreground">idle asset</span>
                    <span className="text-right font-mono text-xs">{fmtUnits(vaultPosition.idleAsset, 18)}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Cross-chain position — one row per connected wallet. Each row reads
              vault.balanceOf(holder) where holder = the user's derived hub wallet for that
              chain (the CREATE3 router on Sonic, the per-spoke hub wallet otherwise) — where
              leverage deposits always deliver shares. Total sums all chains. */}
          {connectedHolders.length > 0 && (
            <div className="border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-2 font-medium">
                <span>Your shares (all chains)</span>
                <span className="font-mono text-right">
                  {fmtUnits(totalShares, lsodaToken.decimals)} {lsodaToken.symbol}
                </span>
              </div>
              {/* Underlying-equivalent — shares × current share price. Shows what the
                  user would get if they fully exited *right now*, in vault-asset units
                  (sodaWEETH-style, 18 dec). Tracks vault performance for the user. */}
              {vaultStats && totalShares > 0n && (
                <div className="flex justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">≈ underlying</span>
                  <span className="font-mono text-muted-foreground text-right">
                    {fmtUnits((totalShares * vaultStats.sharePrice) / 10n ** 18n, 18)}
                  </span>
                </div>
              )}
              <div className="space-y-0.5 pt-1">
                {connectedHolders.map(({ chainKey }, i) => {
                  const q = sharesByChain[i];
                  const d = q?.data;
                  if (d && d.shares > 0n) {
                    return (
                      <div key={chainKey} className="flex justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          {chainKey} <span className="opacity-60">(hub wallet)</span>
                        </span>
                        <span className="font-mono text-right">{fmtUnits(d.shares, lsodaToken.decimals)}</span>
                      </div>
                    );
                  }
                  return null;
                })}
                {renderSharesStatus()}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="w-full max-w-xl mx-auto">
        <CardContent className="pt-6">
          <Tabs value={tab} onValueChange={v => setTab(v as 'deposit' | 'withdraw')}>
            <TabsList className="w-full">
              <TabsTrigger value="deposit" className="flex-1">
                Deposit
              </TabsTrigger>
              <TabsTrigger value="withdraw" className="flex-1">
                Withdraw
              </TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="space-y-4 pt-4">
              {/* Single-side flow. The user only ever interacts with ONE chain (their EOA's
                  chain). For deposit: that's where they hold the input token. For withdraw:
                  that's where the swap output lands AND where they sign the sendMessage that
                  authorises their hub wallet to create the intent. Hub wallet is derived
                  deterministically — no Sonic connection needed. */}
              <div className="space-y-2">
                <Label>{tab === 'deposit' ? 'Your chain' : 'Receive on'}</Label>
                <ChainSelector
                  selectedChainId={userChain}
                  selectChainId={setUserChain}
                  allowedChains={supportedSpokeChains}
                />
                <div className="text-xs text-muted-foreground break-all">
                  {userAccount.address ? (
                    <>
                      signer: <code>{userAccount.address}</code>
                    </>
                  ) : (
                    <span className="text-amber-600">connect a wallet on {userChain}</span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>{tab === 'deposit' ? 'Pay with' : 'Receive token'}</Label>
                  {tab === 'deposit' && userToken && userBalance !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      balance: <span className="font-mono">{fmtUnits(userBalance, userToken.decimals)}</span>
                    </span>
                  )}
                  {tab === 'withdraw' && userShares !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      your shares: <span className="font-mono">{fmtUnits(userShares, lsodaToken.decimals)}</span>{' '}
                      {lsodaToken.symbol}
                    </span>
                  )}
                </div>
                <Select
                  value={userToken?.address}
                  onValueChange={addr => setUserTokenSymbol(userTokens.find(t => t.address === addr)?.symbol)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Token" />
                  </SelectTrigger>
                  <SelectContent>
                    {userTokens.map(t => (
                      <SelectItem key={t.address} value={t.address}>
                        {t.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>
                  {tab === 'deposit'
                    ? `Amount (${userToken?.symbol ?? 'token'})`
                    : `Shares to redeem (${lsodaToken.symbol})`}
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="0.0"
                    value={sourceAmount}
                    onChange={e => setSourceAmount(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Max source amount depends on the active flow:
                      //   deposit  → wallet balance of the chosen input token
                      //   withdraw → user's lsoda* share balance (in hub wallet)
                      const maxRaw = tab === 'deposit' ? userBalance : userShares;
                      const decimals = tab === 'deposit' ? (userToken?.decimals ?? 18) : lsodaToken.decimals;
                      if (maxRaw !== undefined) setSourceAmount(formatUnits(maxRaw, decimals));
                    }}
                    disabled={tab === 'deposit' ? !userToken || userBalance === undefined : userShares === undefined}
                  >
                    Max
                  </Button>
                </div>
              </div>

              {/* Output preview — readonly. Updates as the quote streams in. */}
              <div className="text-xs text-muted-foreground space-y-0.5 border-t pt-3">
                {quote?.quoted_amount !== undefined && dst.token && (
                  <div className="text-sm text-foreground">
                    You'll receive ≈{' '}
                    <span className="font-mono">{fmtUnits(quote.quoted_amount, dst.token.decimals)}</span>{' '}
                    {dst.token.symbol}{' '}
                    <span className="text-xs text-muted-foreground">
                      {tab === 'deposit' ? '(in your hub wallet)' : `(on ${userChain}, to your address)`}
                    </span>
                  </div>
                )}
                {exchangeRate && dst.token && src.token && (
                  <div>
                    rate: 1 {src.token.symbol} ≈ <span className="font-mono">{exchangeRate.toFixed(6)}</span>{' '}
                    {dst.token.symbol}
                  </div>
                )}
                {minOutputAmount !== undefined && dst.token && (
                  <div>
                    min received ({slippage}% slippage):{' '}
                    <span className="font-mono">{fmtUnits(minOutputAmount, dst.token.decimals)}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Label className="text-xs">slippage %</Label>
                  <Input
                    type="number"
                    value={slippage}
                    onChange={e => setSlippage(e.target.value)}
                    className="h-9 w-24 text-base sm:h-7 sm:text-xs"
                  />
                </div>
              </div>

              {/* Action — only the user's spoke wallet matters. Dst address is always
                  derived (hub wallet on deposit; userAccount on withdraw). */}
              {!userAccount.address ? (
                <Button onClick={openWalletModal} className="w-full">
                  Connect wallet
                </Button>
              ) : showEvmSwitch ? (
                <Button onClick={handleSwitchChain} className="w-full" variant="cherryOutline">
                  Switch wallet to {userChain}
                </Button>
              ) : !intentOrderPayload ? (
                <Button
                  onClick={prepare}
                  disabled={!quote || !sourceAmount || quoteQuery.isFetching}
                  className="w-full"
                >
                  {quoteQuery.isFetching ? 'Quoting…' : 'Review'}
                </Button>
              ) : tab === 'deposit' && isAllowanceLoading ? (
                <Button disabled className="w-full">
                  Checking allowance…
                </Button>
              ) : tab === 'deposit' && !hasAllowance ? (
                <Button onClick={handleApprove} disabled={isApproving} className="w-full">
                  {isApproving ? 'Approving…' : 'Approve'}
                </Button>
              ) : (
                <Button onClick={handleSwap} disabled={isSwapping} className="w-full">
                  {isSwapping ? 'Swapping…' : tab === 'deposit' ? 'Deposit' : 'Withdraw'}
                </Button>
              )}

              {actionError && <div className="text-sm text-red-600 break-all">{actionError}</div>}
            </TabsContent>
          </Tabs>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          {tab === 'deposit'
            ? `Swap any token via the Sodax solver into ${lsodaToken.symbol}. Shares land in your hub wallet — no Sonic connection needed.`
            : `Burns ${lsodaToken.symbol} from your hub wallet via a cross-chain message you sign on ${userChain}; the swapped output lands at your address there.`}
        </CardFooter>
      </Card>
    </div>
  );
}
