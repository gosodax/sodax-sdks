# @sodax/dapp-kit

High-level React hooks library for dApp developers. Wraps `@sodax/sdk` with React Query into feature-organized hooks. Used alongside `@sodax/wallet-sdk-react` (no direct dependency — shared types come from `@sodax/sdk`).

## Features

- **Swap/Intent** — `useSwapLifecycle`, `useQuote`, `useSwap`, `useSwapWithApproval`, `useSwapApprovalStrategy`, `useSwapAllowance`, `useSwapApprove`, `useDetailedStatus`, `useCancelSwap`, `useCreateLimitOrder`, `useCancelLimitOrder`, `useStatus`
- **Bridge** — `useBridge`, `useBridgeDetailedStatus`, `useBridgeAllowance`, `useBridgeApprove`, `useGetBridgeableAmount`, `useGetBridgeableTokens`
- **Money Market** — `useSupply`, `useWithdraw`, `useBorrow`, `useRepay`, `useMMAllowance`, `useMMApprove`, plus reserves data hooks
- **Staking** — `useStake`, `useUnstake`, `useInstantUnstake`, `useClaim`, `useCancelUnstake`, approval hooks, info/config/ratio queries
- **DEX** — `useDexDeposit`, `useDexWithdraw`, `useSupplyLiquidity`, `useDecreaseLiquidity`, `useClaimRewards`, pool/position queries, param builders
- **Leverage Yield** — `useLeverageYieldDeposit`, `useLeverageYieldWithdraw`, `useLeverageYieldVaultSwap`, `useLeverageYieldDetailedStatus`, `useLeverageYieldNotifySolver`, plus vault position/APR/TVL/share queries
- **Migration** — `useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln`, `useMigrationApprove`, `useMigrationAllowance`
- **Bitcoin (Bound Exchange)** — `useRadfiAuth`, `useEnsureRadfiAccessToken`, `useRadfiSession`, `useTradingWallet`, `useTradingWalletBalance`, `useBitcoinBalance`, `useBitcoinTradingSetup`, `useFundTradingWallet`, `useRadfiWithdraw`, `useExpiredUtxos`, `useRenewUtxos`
- **Partner** — `useFetchAssetsBalances`, `useGetAutoSwapPreferences`, `useIsTokenApproved`, `useApproveToken`, `useSetSwapPreference`, `useFeeClaimSwap`, `useFeeClaimWithdraw`, `usePartnerCancelIntent`, `useGetUserIntent`, `useGetIntentDetails`
- **Recovery** — `useHubAssetBalances`, `useWithdrawHubAsset`
- **Backend Queries** — Intent tracking, swap-tx submission + status, orderbook, money market position queries
- **Shared** — `useXBalances`, `useDeriveUserWalletAddress`, `useGetUserHubWalletAddress`, `useStellarTrustlineCheck`, `useEstablishTrustline`, `useStellarGate`, `useNearStorageCheck`, `useRegisterNearStorage`, `useNearStorageGate`, `useEstimateGas`
- **Sponsoring** — `useStellarAccountActive`, `useStellarAccountStatus`, `useSponsorConfig`, `useActivateStellarAccount`

## Installation

```bash
pnpm add @sodax/dapp-kit @tanstack/react-query
# Optional: wallet connectivity
pnpm add @sodax/wallet-sdk-react
```

## Quick Start

### 1. Set up providers

RPC URLs are injected through `config.chains`. `SodaxProvider` is the outermost wrapper; `QueryClientProvider` wraps everything inside it.

```tsx
// providers.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit';
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ChainKeys, type SodaxOptions } from '@sodax/sdk';

const queryClient = createSodaxQueryClient();

const sodaxConfig: SodaxOptions = {
  chains: {
    [ChainKeys.SONIC_MAINNET]: { rpcUrl: 'https://sonic-rpc.publicnode.com' },
    [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
    [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.drpc.org' },
    [ChainKeys.ARBITRUM_MAINNET]: { rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    // Add chains your dApp needs
  },
};

const walletConfig: SodaxWalletConfig = {
  EVM: {
    chains: {
      [ChainKeys.BSC_MAINNET]: { rpcUrl: 'https://bsc-dataseed.binance.org' },
      [ChainKeys.BASE_MAINNET]: { rpcUrl: 'https://base.drpc.org' },
    },
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SodaxProvider config={sodaxConfig}>
      <QueryClientProvider client={queryClient}>
        <SodaxWalletProvider config={walletConfig}>
          {children}
        </SodaxWalletProvider>
      </QueryClientProvider>
    </SodaxProvider>
  );
}
```

`SodaxProvider` builds its `Sodax` instance in the browser, so `sodaxConfig` ships in your bundle. Leave
`apiKey` out of it: to send a SODAX API key, point `api.baseURL` and `solver.solverApiEndpoint` at your own
backend proxy and attach the key there — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

### 2. Get a wallet provider

```tsx
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';

function MyFeature() {
  const walletProvider = useWalletProvider(ChainKeys.BSC_MAINNET);
  // undefined until wallet is connected
}
```

### 3. Use feature hooks

All mutation hooks accept no arguments at initialization. Domain inputs (params, walletProvider) flow through `mutate(vars)`:

```tsx
import { useSwap } from '@sodax/dapp-kit';
import { useWalletProvider } from '@sodax/wallet-sdk-react';
import { ChainKeys } from '@sodax/sdk';
import type { CreateIntentParams } from '@sodax/sdk';

function SwapButton({ intentParams }: { intentParams: CreateIntentParams }) {
  const walletProvider = useWalletProvider(ChainKeys.BSC_MAINNET);
  const { mutateAsyncSafe: swap, isPending } = useSwap();

  const handleSwap = async () => {
    if (!walletProvider) return;
    const result = await swap({ params: intentParams, walletProvider });
    if (!result.ok) {
      alert(result.error instanceof Error ? result.error.message : 'Swap failed');
      return;
    }
    console.log('Swap submitted!', result.value);
  };

  return (
    <button onClick={handleSwap} disabled={isPending || !walletProvider}>
      {isPending ? 'Swapping...' : 'Swap'}
    </button>
  );
}
```

## Requirements

- Node.js >= 22.12.0
- React >= 18
- TypeScript

## API Reference

### Provider

- [`SodaxProvider`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/providers/SodaxProvider.tsx) — Wraps your app, creates the `Sodax` SDK instance. Accepts `config?: SodaxOptions`.
- [`createSodaxQueryClient()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/providers/createSodaxQueryClient.ts) — Factory for a `QueryClient` with global mutation observability (`onMutationError` hook, `meta.silent` opt-out).

### Swap Hooks

- [`useQuote()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useQuote.ts) — Real-time quote (auto-refreshes every 3s)
- [`useSwap()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwap.ts) — Submit a cross-chain swap intent
- [`useSwapAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwapAllowance.ts) — Check token approval
- [`useSwapApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwapApprove.ts) — Approve token spending
- [`useSwapLifecycle()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwapLifecycle.ts) — A whole swap form as one discriminated `state` and one `next()` action: approval strategy, Stellar/NEAR destination gates, source-chain switch (passed in), the swap and its status. A swap that fails after broadcast stays `pending` with its `error`; a batch that was sent but not confirmed is `unconfirmed`, and `next()` waits for it again (never re-sends it) and finishes the swap once it lands. The hooks it composes are returned as escape hatches
- [`useSwapWithApproval()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwapWithApproval.ts) — `useSwap` with the approval folded in: approve + swap as one EIP-5792 batch (one signature) on a wallet that can batch, otherwise approve then swap. `allowAccountUpgrade: false` skips the smart-account upgrade prompt a `'ready'` wallet would show and approves separately
- [`useSwapApprovalStrategy()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useSwapApprovalStrategy.ts) — Which path `useSwapWithApproval` will take (`'not-required'` / `'atomic-batch'` / `'sequential'`), to label the button
- [`useDetailedStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useDetailedStatus.ts) — Poll a swap's status from its **source** tx (`{ srcChainKey, srcTxHash }`), whichever completion path ran — the default status read. Collapse `data.value` with `summarizeSwapStatus` from `@sodax/sdk`
- [`useStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useStatus.ts) — Poll the solver's status by **hub** tx hash (`intentDeliveryInfo.dstTxHash`)
- [`useCancelSwap()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useCancelSwap.ts) — Cancel a pending swap
- [`useCreateLimitOrder()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useCreateLimitOrder.ts) — Create a limit order (no deadline)
- [`useCancelLimitOrder()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swap/useCancelLimitOrder.ts) — Cancel a limit order

### Money Market Hooks

- [`useSupply()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useSupply.ts) — Supply collateral
- [`useWithdraw()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useWithdraw.ts) — Withdraw supplied tokens
- [`useBorrow()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useBorrow.ts) — Borrow against collateral
- [`useRepay()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useRepay.ts) — Repay borrowed tokens
- [`useMMAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useMMAllowance.ts) — Check approval (auto-skips for borrow/withdraw)
- [`useMMApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useMMApprove.ts) — Approve token spending
- [`useReservesData()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useReservesData.ts) — All reserve data
- [`useReservesHumanized()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useReservesHumanized.ts) — Reserves in decimal-normalized format
- [`useReservesList()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useReservesList.ts) — List of reserve asset addresses
- [`useReservesUsdFormat()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useReservesUsdFormat.ts) — Reserves with USD values
- [`useUserFormattedSummary()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useUserFormattedSummary.ts) — User portfolio summary (health factor, collateral, debt)
- [`useUserReservesData()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useUserReservesData.ts) — User reserve positions
- [`useAToken()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useAToken.ts) — aToken metadata
- [`useATokensBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/mm/useATokensBalances.ts) — aToken balances

### Bridge Hooks

- [`useBridge()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useBridge.ts) — Execute a cross-chain bridge transfer
- [`useBridgeDetailedStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useBridgeDetailedStatus.ts) — Track a bridge from its source tx, whichever completion path ran
- [`useBridgeAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useBridgeAllowance.ts) — Check token approval
- [`useBridgeApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useBridgeApprove.ts) — Approve token spending
- [`useGetBridgeableAmount()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useGetBridgeableAmount.ts) — Max bridgeable amount between two tokens
- [`useGetBridgeableTokens()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridge/useGetBridgeableTokens.ts) — Tokens bridgeable to a destination chain

### Staking Hooks

- [`useStake()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStake.ts) — Stake SODA, receive xSODA
- [`useUnstake()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstake.ts) — Request unstake (waiting period)
- [`useInstantUnstake()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useInstantUnstake.ts) — Instant unstake with slippage
- [`useClaim()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useClaim.ts) — Claim SODA after waiting period
- [`useCancelUnstake()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useCancelUnstake.ts) — Cancel pending unstake
- [`useStakeApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakeApprove.ts) — Approve SODA for staking
- [`useUnstakeApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstakeApprove.ts) — Approve xSODA for unstaking
- [`useInstantUnstakeApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useInstantUnstakeApprove.ts) — Approve xSODA for instant unstaking
- [`useStakeAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakeAllowance.ts) — Check SODA approval
- [`useUnstakeAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstakeAllowance.ts) — Check xSODA approval for unstaking
- [`useInstantUnstakeAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useInstantUnstakeAllowance.ts) — Check xSODA approval for instant unstaking
- [`useStakingInfo()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakingInfo.ts) — User staking position
- [`useUnstakingInfo()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstakingInfo.ts) — Pending unstake requests
- [`useUnstakingInfoWithPenalty()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useUnstakingInfoWithPenalty.ts) — Unstake requests with penalty calcs
- [`useStakingConfig()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakingConfig.ts) — Unstaking period, max penalty
- [`useStakeRatio()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useStakeRatio.ts) — SODA-to-xSODA exchange rate
- [`useInstantUnstakeRatio()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useInstantUnstakeRatio.ts) — Instant unstake rate
- [`useConvertedAssets()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/staking/useConvertedAssets.ts) — xSODA to SODA conversion

### Leverage Position Hooks

A position is one Aave account owned by the user's **hub wallet**, never their signing address — pass
the signer as `params.srcAddress` and the SDK resolves the owner.

Which write hook to use is decided by the operation, not by preference. `increaseLeverage` and
`decreaseLeverage` only **post** a solver intent, and an intent the solver was never told about
expires unfilled, so those go through `useSubmitLeveragePositionIntent()`, which reports it.
`withdraw`, `settle` and `cancel` are synchronous on the hub and need no notification.

- [`useOpenLeveragePosition()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useOpenLeveragePosition.ts) — Open a position (`side: 'collateral' | 'debt'`) and report its intent
- [`useSubmitLeveragePositionIntent()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useSubmitLeveragePositionIntent.ts) — Run `increaseLeverage` / `decreaseLeverage` and report the intent
- [`useRunLeveragePositionOperation()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useRunLeveragePositionOperation.ts) — Run `withdraw` / `settle` / `cancel`; no intent, nothing to report
- [`useLeveragePositionPayoutAddress()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeveragePositionPayoutAddress.ts) — Where a withdrawal can be paid, which off the hub is not the signer
- [`useLeveragePositionFundingAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeveragePositionFundingAllowance.ts) — Whether the funding token is approved; the spender is chain-dependent
- [`useApproveLeveragePositionFunding()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useApproveLeveragePositionFunding.ts) — Approve it, against the spender the SDK resolves
- [`useLeveragePositionsForUser()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeveragePositionsForUser.ts) — A user's positions, discovered through their hub wallet
- [`useLeveragePositionAccount()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeveragePositionAccount.ts) — Collateral, debt, LTV and health factor
- [`useLeveragePositionInfo()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeveragePositionInfo.ts) — The position's collateral and borrow reserves
- [`useLeveragePositionCollateral()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeveragePositionCollateral.ts) — Collateral balance held
- [`useLeveragePositionPending()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeveragePositionPending.ts) — The pending-operation slot; a position permits one at a time

> Resolving means the intent is **live**, not that leverage moved. Off-hub (spoke) origins are
> experimental and unverified on-chain; see each hook's JSDoc.

### DEX Hooks

- [`usePools()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/usePools.ts) — List available pools
- [`usePoolData()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/usePoolData.ts) — Pool details (price, tick, liquidity)
- [`usePoolBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/usePoolBalances.ts) — User pool token balances
- [`usePositionInfo()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/usePositionInfo.ts) — Position details by token ID
- [`useDexDeposit()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDexDeposit.ts) — Deposit assets into pool tokens
- [`useDexWithdraw()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDexWithdraw.ts) — Withdraw assets from pool tokens
- [`useDexAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDexAllowance.ts) — Check approval for deposit
- [`useDexApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDexApprove.ts) — Approve token spending
- [`useLiquidityAmounts()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useLiquidityAmounts.ts) — Token amounts for a tick range
- [`useSupplyLiquidity()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useSupplyLiquidity.ts) — Supply liquidity to a position
- [`useDecreaseLiquidity()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useDecreaseLiquidity.ts) — Remove liquidity
- [`useClaimRewards()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useClaimRewards.ts) — Claim trading fees
- [`useCreateDepositParams()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useCreateDepositParams.ts) — Build deposit params with ERC-4626 conversion
- [`useCreateWithdrawParams()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useCreateWithdrawParams.ts) — Build withdraw params
- [`useCreateSupplyLiquidityParams()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useCreateSupplyLiquidityParams.ts) — Build tick range + liquidity params
- [`useCreateDecreaseLiquidityParams()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/dex/useCreateDecreaseLiquidityParams.ts) — Build decrease params from position state

### Leverage Yield Hooks

- [`useLeverageYieldEffectiveApr()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldEffectiveApr.ts) — Vault effective APR (AAVE rates + LSD yield, leverage-adjusted; refreshes 60s)
- [`useLeverageYieldPosition()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldPosition.ts) — Live position snapshot: collateral, debt, LTV, health factor, idle assets (refreshes 30s)
- [`useLeverageYieldTotalAssets()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldTotalAssets.ts) — Vault total underlying assets (TVL)
- [`useLeverageYieldPreviewRedeem()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldPreviewRedeem.ts) — Assets received for redeeming shares (ERC-4626 `previewRedeem`)
- [`useLeverageYieldShareBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldShareBalances.ts) — User `lsoda*` share balances across every chain they may hold a position under
- [`useLeverageYieldDeposit()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldDeposit.ts) — Build the deposit payload (any token → `lsoda*` shares) for `useLeverageYieldVaultSwap`
- [`useLeverageYieldWithdraw()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldWithdraw.ts) — Build the withdraw payload (`lsoda*` shares → any token) for `useLeverageYieldVaultSwap`
- [`useLeverageYieldVaultSwap()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldVaultSwap.ts) — Execute an end-to-end vault swap (deposit or withdraw); backend 2-step by default, with the client-side fallback
- [`useLeverageYieldDetailedStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldDetailedStatus.ts) — Track a vault swap from its source tx, whichever completion path ran
- [`useLeverageYieldNotifySolver()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/leverageYield/useLeverageYieldNotifySolver.ts) — Notify the solver that a vault intent landed on the hub (standalone step for manual relay flows)

### Migration Hooks

- [`useMigrateIcxToSoda()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigrateIcxToSoda.ts) — ICX/wICX (ICON) → SODA (Sonic)
- [`useRevertMigrateSodaToIcx()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useRevertMigrateSodaToIcx.ts) — SODA (Sonic) → wICX (ICON)
- [`useMigratebnUSD()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigratebnUSD.ts) — Legacy bnUSD ↔ new bnUSD (bidirectional)
- [`useMigrateBaln()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigrateBaln.ts) — BALN (ICON) → SODA with optional lock period
- [`useMigrationApprove()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigrationApprove.ts) — Approve token spending before migration
- [`useMigrationAllowance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/migrate/useMigrationAllowance.ts) — Check if approval is needed

### Bitcoin (Bound Exchange) Hooks

- [`useRadfiSession()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useRadfiSession.ts) — Manage Bound Exchange session (login, auto-refresh)
- [`useRadfiAuth()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useRadfiAuth.ts) — Authenticate with Bound Exchange via BIP322 signing
- [`useEnsureRadfiAccessToken()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useEnsureRadfiAccessToken.ts) — Ensure a valid Bound Exchange access token (refresh, or full re-auth), returning it for a Bitcoin-source createIntent
- [`useTradingWallet()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useTradingWallet.ts) — Get trading wallet address from persisted session
- [`useBitcoinBalance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useBitcoinBalance.ts) — BTC balance for any address
- [`useTradingWalletBalance()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useTradingWalletBalance.ts) — Trading wallet balance from Bound Exchange API
- [`useBitcoinTradingSetup()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useBitcoinTradingSetup.ts) — Bitcoin trading-wallet setup for one side of a cross-chain flow (inert unless the chain is Bitcoin)
- [`useFundTradingWallet()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useFundTradingWallet.ts) — Fund trading wallet from personal wallet
- [`useRadfiWithdraw()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useRadfiWithdraw.ts) — Withdraw from trading wallet
- [`useExpiredUtxos()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useExpiredUtxos.ts) — Fetch expired UTXOs (polls every 60s)
- [`useRenewUtxos()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bitcoin/useRenewUtxos.ts) — Renew expired UTXOs

### Partner Hooks

- [`useFetchAssetsBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useFetchAssetsBalances.ts) — Fetch partner asset balances
- [`useGetAutoSwapPreferences()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useGetAutoSwapPreferences.ts) — Get auto-swap preferences
- [`useIsTokenApproved()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useIsTokenApproved.ts) — Check token approval
- [`useApproveToken()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useApproveToken.ts) — Approve token
- [`useSetSwapPreference()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useSetSwapPreference.ts) — Set swap preference
- [`useFeeClaimSwap()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useFeeClaimSwap.ts) — Claim partner fees via swap
- [`useFeeClaimWithdraw()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useFeeClaimWithdraw.ts) — Withdraw a partner fee balance via a Sonic-sourced bridge to the destination chain
- [`usePartnerCancelIntent()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/usePartnerCancelIntent.ts) — Cancel a stuck partner fee-claim auto-swap intent and recover the locked tokens
- [`useGetUserIntent()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useGetUserIntent.ts) — Look up the stored intent hash for a partner `(user, fromToken, toToken)` pair
- [`useGetIntentDetails()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/partner/useGetIntentDetails.ts) — Fetch the full intent details for a ProtocolIntents intent hash

### Recovery Hooks

- [`useHubAssetBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/recovery/useHubAssetBalances.ts) — Get hub asset balances
- [`useWithdrawHubAsset()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/recovery/useWithdrawHubAsset.ts) — Withdraw hub asset

### Shared Hooks

- [`useSodaxContext()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useSodaxContext.ts) — Access the `Sodax` SDK instance
- [`useHubProvider()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/provider/useHubProvider.ts) — Access the hub chain (Sonic) provider
- [`useXBalances()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useXBalances.ts) — Cross-chain token balances for an address
- [`useDeriveUserWalletAddress()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useDeriveUserWalletAddress.ts) — Derive hub wallet address (CREATE3)
- [`useGetUserHubWalletAddress()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useGetUserHubWalletAddress.ts) — Derive hub wallet address (wallet router)
- [`useEstimateGas()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useEstimateGas.ts) — Estimate gas for transactions
- [`useStellarTrustlineCheck()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useStellarTrustlineCheck.ts) — Check Stellar trustline
- [`useEstablishTrustline()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useEstablishTrustline.ts) — Request Stellar trustline
- [`useRequestTrustline()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useRequestTrustline.ts) — **Deprecated**, use `useEstablishTrustline()`
- [`useStellarGate()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useStellarGate.ts) — Sequences the Stellar destination prerequisites (activation → funding → trustline)
- [`useNearStorageCheck()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useNearStorageCheck.ts) — Check NEP-141 storage registration for a token on NEAR (NEAR's analogue of a Stellar trustline)
- [`useRegisterNearStorage()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useRegisterNearStorage.ts) — Submit a NEP-141 `storage_deposit` so a NEAR account can receive a token
- [`useNearStorageGate()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/useNearStorageGate.ts) — Derive the NEP-141 storage-registration UI gate state for a NEAR delivery

### Sponsoring Hooks

Stellar accounts must exist on-chain before they can hold or receive anything, and a new user holds 0 XLM.
These drive sponsored activation, where the SODAX sponsor pays the account's base reserve.

- [`useStellarAccountActive()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/sponsoring/useStellarAccountActive.ts) — Whether a Stellar account exists on-chain
- [`useStellarAccountStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/sponsoring/useStellarAccountStatus.ts) — Existence plus whether the account can afford a trustline
- [`useSponsorConfig()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/sponsoring/useSponsorConfig.ts) — Sponsor account, network, fee band, max time bounds
- [`useActivateStellarAccount()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/sponsoring/useActivateStellarAccount.ts) — Activate a Stellar account via the sponsor

### Backend Query Hooks

- [`useBackendIntentByTxHash()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendIntentByTxHash.ts) — Get intent by hub tx hash (polls 1s)
- [`useBackendIntentByHash()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendIntentByHash.ts) — Get intent by intent hash
- [`useBackendUserIntents()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendUserIntents.ts) — All intents for a user with date filtering
- [`useBackendOrderbook()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendOrderbook.ts) — Solver orderbook (cached 30s, no auto-refetch)
- [`useBackendMoneyMarketPosition()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendMoneyMarketPosition.ts) — User money market position
- [`useBackendAllMoneyMarketAssets()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendAllMoneyMarketAssets.ts) — All MM assets
- [`useBackendMoneyMarketAsset()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendMoneyMarketAsset.ts) — Single MM asset details
- [`useBackendMoneyMarketAssetBorrowers()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendMoneyMarketAssetBorrowers.ts) — Asset borrowers
- [`useBackendMoneyMarketAssetSuppliers()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendMoneyMarketAssetSuppliers.ts) — Asset suppliers
- [`useBackendAllMoneyMarketBorrowers()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendAllMoneyMarketBorrowers.ts) — All borrowers
- [`useBackendOracleMarkets()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendOracleMarkets.ts) — Oracle candle discovery: quote, intervals, symbols (cached 60s)
- [`useBackendOracleCandles()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/backend/useBackendOracleCandles.ts) — USD OHLC candles for a symbol over `[from, to)` (cached 10s)

### Swaps API Hooks (`sodax.api.swaps`)

Typed wrappers over the backend Swaps API — one `useSwapsApi*` hook per endpoint (21 total). Highlights:

- [`useSwapsApiQuote()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiQuote.ts) — Solver quote for a cross-chain swap
- [`useSwapsApiCreateIntent()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiCreateIntent.ts) — Build an unsigned create-intent tx
- [`useSwapsApiBroadcastWithApproval()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiBroadcastWithApproval.ts) — Approve and broadcast the intent tx in one signature on an EIP-5792 wallet (EVM sources)
- [`useSwapsApiSubmitTx()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiSubmitTx.ts) — Submit swap tx to backend
- [`useSwapsApiSubmitTxStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/swapsApi/useSwapsApiSubmitTxStatus.ts) — Check submitted swap status

See [`src/hooks/swapsApi/`](https://github.com/icon-project/sodax-sdks/tree/main/packages/dapp-kit/src/hooks/swapsApi) for the full set (tokens, deadline, allowance, approve, submit/cancel intent, status, hash, packet, extra-data, intent lookups, limit orders, gas, fees).

### Bridge API Hooks (`sodax.api.bridge`)

Typed wrappers over the backend Bridge API v2 — one `useBridgeApi*` hook per endpoint. Highlights:

- [`useBridgeApiSubmitTx()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridgeApi/useBridgeApiSubmitTx.ts) — Hand a broadcast spoke-deposit tx to the backend relay pipeline
- [`useBridgeApiSubmitTxStatus()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/bridgeApi/useBridgeApiSubmitTxStatus.ts) — Poll a submitted bridge tx by `(txHash, srcChainKey)`

See [`src/hooks/bridgeApi/`](https://github.com/icon-project/sodax-sdks/tree/main/packages/dapp-kit/src/hooks/bridgeApi) for the full set (tokens, allowance, approve, create intent, fee, bridgeable amount, bridgeable pair).

### API-key failures are terminal

Every retrying `useSwapsApi*`, `useLeverageYieldApi*` and `useBridgeApi*` hook defaults `retry` to [`retryUnlessAuthFailure()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/hooks/shared/retryUnlessAuthFailure.ts): transport blips retry up to 3 times, a `401`/`403` never replays. `useSwapsApiStatus`, `useSwapsApiSubmitTxStatus`, `useLeverageYieldApiSubmitTxStatus` and `useBridgeApiSubmitTxStatus` stop their 1s poll on a rejected key too, since `retry` bounds attempts within a tick rather than the interval — so a bad key surfaces once, on `error`, instead of re-requesting forever. Override either through `queryOptions` / `mutationOptions`.

`useDetailedStatus` and `useBridgeDetailedStatus` stop on a rejected key as well, but by a different route: the SDK hands them the `401`/`403` inside a `Result` rather than throwing, so React Query never sees an error and `retry` has nothing to withhold. Their poll interval checks `isAuthFailure(data.error)` instead. It has to — a rejected key leaves the backend unanswered, so a relay miss behind it is never tagged `DETAILED_STATUS_NOT_DELIVERED`, and the not-delivered budget that stops every other unresolved read would never advance.

### Utils

DEX param builders:

- [`createDepositParamsProps()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/dex-utils.ts) — Build deposit params from pool data and spoke asset info
- [`createWithdrawParamsProps()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/dex-utils.ts) — Build withdraw params with optional destination info
- [`createSupplyLiquidityParamsProps()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/dex-utils.ts) — Build concentrated liquidity supply params
- [`createDecreaseLiquidityParamsProps()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/dex-utils.ts) — Build decrease liquidity params

NEAR storage gate:

- [`resolveNearStorageGate()`](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/utils/nearStorageGate.ts) — Derive the NEP-141 storage-registration UI gate state (hook-free counterpart of `useNearStorageGate`)

## Development

```bash
pnpm install     # Install dependencies
pnpm build       # Build the package (ESM + CJS)
pnpm dev         # Watch mode
pnpm checkTs     # Type checking
pnpm test        # Run tests
pnpm pretty      # Format code
pnpm lint        # Lint code
```

## AI agent docs

AI-readable docs for `@sodax/dapp-kit` (and the other `@sodax/*` packages) are shipped via [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills) — a separate npm package bundling Claude-Code SKILL.md files and a long-form knowledge tree.

**Recommended: [`skills` CLI](https://github.com/vercel-labs/skills)** — from your project root:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

**npm + `AGENTS.md` pointer** (fallback for web chats, or when you prefer a devDependency over the CLI):

```bash
pnpm add -D @sodax/skills
```

Then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md) for all install modes and per-tool wiring.

## License

[MIT](https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/LICENSE)

## Support

- [GitHub Issues](https://github.com/icon-project/sodax-sdks/issues)
- [Discord Community](https://discord.gg/sodax-formerly-icon-880651922682560582)
