# Hooks index — `@sodax/dapp-kit` v2

Comprehensive hook table across 12 feature domains. Use this when you know the feature you're building but don't remember the exact hook name.

## Provider + context

| Hook | Type | Purpose |
|---|---|---|
| `SodaxProvider` | Component | Wraps app; provides `Sodax` instance + RPC config |
| `createSodaxQueryClient` | Factory | Returns `QueryClient` with global mutation observability |
| `useSodaxContext` | Utility | Access the `Sodax` SDK instance |
| `useHubProvider` | Utility | Hub chain (Sonic) provider |

## Swap

| Hook | Type | Purpose |
|---|---|---|
| `useQuote` | Query | Real-time swap quote (auto-refreshes 3s) |
| `useSwap` | Mutation | Execute a complete cross-chain swap |
| `useSwapAllowance` | Query | Check token approval status |
| `useSwapApprove` | Mutation | Approve tokens for the swap contract |
| `useSwapApprovalStrategy` | Query | Which path `useSwapWithApproval` takes — `'not-required'` / `'atomic-batch'` (one EIP-5792 signature) / `'sequential'`; `allowAccountUpgrade: false` keeps a `'ready'` wallet sequential; no polling |
| `useSwapLifecycle` | Composite | One swap form: `state` (`idle` … `ready` … `pending` / `unconfirmed` / `settled` / `failed`, discriminated on `kind`) + `next()`; composes the strategy, Stellar/NEAR gates, injected chain switch, `useSwapWithApproval` and `useDetailedStatus`, and returns each as an escape hatch; `allowAccountUpgrade` is passed to both |
| `useSwapWithApproval` | Mutation | `useSwap` with the approval folded in: one atomic batch on an EIP-5792 wallet, else approve → swap; `data.approvalStrategy` |
| `useStatus` | Query | Track intent execution status (polls 3s once `intentTxHash` supplied; stops on `3`/`4` and after 40 consecutive NOT_FOUND fetches; Result-wrapped data) |
| `useDetailedStatus` | Query | Track a swap from its source tx (`{ srcChainKey, srcTxHash }`; polls 3s; Result-wrapped; stops on the answering source's terminal state and after 40 consecutive ambiguous reads — solver NOT_FOUND, or a relay with no packet for the tx; outages keep polling). Returns a tagged union — backend submit-tx record or solver answer — narrow on `source`. Unlike `useSwapsApiSubmitTxStatus`, answers for both `swap()` completion paths |
| `useCancelSwap` | Mutation | Cancel an active swap intent |
| `useCreateLimitOrder` | Mutation | Create a limit order (no deadline) |
| `useCancelLimitOrder` | Mutation | Cancel a limit order |

## Money market

| Hook | Type | Purpose |
|---|---|---|
| `useSupply` | Mutation | Supply tokens as collateral |
| `useWithdraw` | Mutation | Withdraw supplied tokens |
| `useBorrow` | Mutation | Borrow against collateral |
| `useRepay` | Mutation | Repay borrowed tokens |
| `useMMAllowance` | Query | Approval check (`enabled: false` for borrow/withdraw — `data` stays `undefined`) |
| `useMMApprove` | Mutation | Approve tokens |
| `useReservesData` | Query | All reserve data (raw) |
| `useReservesHumanized` | Query | Reserves in decimal-normalized form |
| `useReservesList` | Query | List of reserve asset addresses |
| `useReservesUsdFormat` | Query | Reserves with USD overlays |
| `useUserFormattedSummary` | Query | Health factor, collateral, debt summary |
| `useUserReservesData` | Query | Per-reserve user position |
| `useAToken` | Query | aToken metadata |
| `useATokensBalances` | Query | aToken balances |

## Bridge

| Hook | Type | Purpose |
|---|---|---|
| `useBridge` | Mutation | Execute a cross-chain bridge transfer |
| `useBridgeDetailedStatus` | Query | Track a bridge from its source tx (`{ srcChainKey, srcTxHash, apiConfig? }`; polls 3s; Result-wrapped; stops on the answering source's terminal state, on a rejected API key, and after 40 consecutive ambiguous reads — a relay with no packet for the tx; outages keep polling). Returns a tagged union — backend submit-tx record or delivered relay packet — narrow on `source`. Unlike `useBridgeApiSubmitTxStatus`, answers for both `bridge()` completion paths |
| `useBridgeAllowance` | Query | Approval check |
| `useBridgeApprove` | Mutation | Approve tokens for bridge |
| `useGetBridgeableAmount` | Query | Max bridgeable amount between two `XToken`s |
| `useGetBridgeableTokens` | Query | Tokens bridgeable to a destination chain |

## Staking

| Hook | Type | Purpose |
|---|---|---|
| `useStake` | Mutation | Stake SODA, receive xSODA |
| `useUnstake` | Mutation | Request unstake (waiting period) |
| `useInstantUnstake` | Mutation | Instant unstake (with slippage) |
| `useClaim` | Mutation | Claim SODA after waiting period |
| `useCancelUnstake` | Mutation | Cancel pending unstake |
| `useStakeApprove` | Mutation | Approve SODA for staking |
| `useUnstakeApprove` | Mutation | Approve xSODA for unstaking |
| `useInstantUnstakeApprove` | Mutation | Approve xSODA for instant unstaking |
| `useStakeAllowance` | Query | Check SODA approval |
| `useUnstakeAllowance` | Query | Check xSODA approval (unstaking) |
| `useInstantUnstakeAllowance` | Query | Check xSODA approval (instant) |
| `useStakingInfo` | Query | User position |
| `useUnstakingInfo` | Query | Pending unstake requests |
| `useUnstakingInfoWithPenalty` | Query | Pending requests + penalty calcs |
| `useStakingConfig` | Query | Unstaking period, max penalty |
| `useStakeRatio` | Query | SODA-to-xSODA exchange rate (returns tuple) |
| `useInstantUnstakeRatio` | Query | Instant unstake rate |
| `useConvertedAssets` | Query | xSODA → SODA conversion |

## DEX

| Hook | Type | Purpose |
|---|---|---|
| `usePools` | Query | List available pools (synchronous; no auto-refresh) |
| `usePoolData` | Query | Pool details (price, tick, liquidity) |
| `usePoolBalances` | Query | User's pool token balances |
| `usePositionInfo` | Query | Position details by tokenId |
| `useLiquidityAmounts` | Query | Token amounts for a tick range |
| `useDexDeposit` | Mutation | Deposit assets into pool tokens |
| `useDexWithdraw` | Mutation | Withdraw assets from pool tokens |
| `useDexAllowance` | Query | Approval check |
| `useDexApprove` | Mutation | Approve tokens |
| `useSupplyLiquidity` | Mutation | Supply liquidity (mint or increase) |
| `useDecreaseLiquidity` | Mutation | Remove liquidity |
| `useClaimRewards` | Mutation | Claim trading fees |
| `useCreateDepositParams` | Param builder | Build deposit params with ERC-4626 conversion |
| `useCreateWithdrawParams` | Param builder | Build withdraw params |
| `useCreateSupplyLiquidityParams` | Param builder | Build tick-range + liquidity params |
| `useCreateDecreaseLiquidityParams` | Param builder | Build decrease params from position state |

## Leverage Yield

No hook lists the vaults: read the registry with `useSodaxContext().sodax.leverageYield.listVaults()` (synchronous; `{ name, vault, asset, borrowToken, lsdSource? }[]`) and pass `vault` to the hooks below. `targetLtvBps` and position `ltv` are basis points; `healthFactor` and `leverageMultiplierWad` are WAD, and the multiplier is the **borrowed** multiple (exposure = 1 + multiplier).

| Hook | Type | Purpose |
|---|---|---|
| `useLeverageYieldDeposit` | Mutation | Build a deposit payload (any token → `lsoda*` shares) — spread into `useLeverageYieldVaultSwap` |
| `useLeverageYieldWithdraw` | Mutation | Build a withdraw payload (`lsoda*` → any token; `hubWalletSwap`) |
| `useLeverageYieldVaultSwap` | Mutation | Execute a built payload end-to-end; backend submit-tx by default, falling back to the client-side create → verify → relay → notify path. `extras.apiKey` keys the backend leg per action |
| `useLeverageYieldDetailedStatus` | Query | Track a vault swap from its source tx (`{ srcChainKey, srcTxHash, apiConfig? }`; polls 3s; Result-wrapped; stops on the answering source's terminal state, on a rejected API key, and after 40 consecutive ambiguous reads — solver NOT_FOUND, or a relay with no packet for the tx; outages keep polling). Returns a tagged union — backend submit-tx record or solver answer — narrow on `source`. Unlike `useLeverageYieldApiSubmitTxStatus`, answers for both `vaultSwap()` completion paths |
| `useLeverageYieldQuote` | Query | Deposit (vault = `token_dst`) or withdraw (vault = `token_src`) quote with the leverage-yield fee (polls 3s; Result-wrapped). Size `minOutputAmount` from `quoted_amount` minus slippage, never `0n` |
| `useLeverageYieldNotifySolver` | Mutation | Manual-flow notify step (after a self-driven `createVaultIntent` + relay) |
| `useLeverageYieldEffectiveApr` | Query | AAVE + LSD effective net APR (60s) |
| `useLeverageYieldPosition` | Query | Live position: collateral, debt, LTV (bps), health factor (WAD), idle (30s) |
| `useLeverageYieldTotalAssets` | Query | Vault TVL (18-dp bigint, 60s) |
| `useLeverageYieldPreviewRedeem` | Query | Assets for N shares; pass `1e18` for price-per-share (60s) |
| `useLeverageYieldShareBalances` | Query | Per-chain `lsoda*` balances via `useQueries` — returns an array (15s) |

## Migration

| Hook | Type | Purpose |
|---|---|---|
| `useMigrateIcxToSoda` | Mutation | ICX/wICX (ICON) → SODA (Sonic) |
| `useRevertMigrateSodaToIcx` | Mutation | SODA (Sonic) → wICX (ICON) |
| `useMigratebnUSD` | Mutation | Legacy bnUSD ↔ new bnUSD (bidirectional) |
| `useMigrateBaln` | Mutation | BALN (ICON) → SODA with optional lock period |
| `useMigrationApprove` | Mutation | Approve before migration (action-discriminated) |
| `useMigrationAllowance` | Query | Approval check (action-discriminated) |

## Bitcoin / Bound Exchange

| Hook | Type | Purpose |
|---|---|---|
| `useRadfiAuth` | Mutation | Authenticate via BIP322 signing |
| `useEnsureRadfiAccessToken` | Mutation | Ensure a fresh Bound access token (silent refresh or BIP322 re-auth) |
| `useRadfiSession` | Utility | Manage full session lifecycle |
| `useTradingWallet` | Utility | Synchronously read trading wallet from localStorage |
| `useBitcoinBalance` | Query | BTC balance for any address |
| `useTradingWalletBalance` | Query | Trading wallet balance from Bound Exchange API |
| `useFundTradingWallet` | Mutation | Fund trading wallet from personal wallet |
| `useRadfiWithdraw` | Mutation | Withdraw from trading wallet |
| `useExpiredUtxos` | Query | Expired UTXOs (polls 60s) |
| `useRenewUtxos` | Mutation | Renew expired UTXOs |

## Backend queries

### Intents

| Hook | Polling |
|---|---|
| `useBackendIntentByTxHash` | 1s (refetchInterval; fires once a `txHash` is set, unconditional) |
| `useBackendIntentByHash` | none |
| `useBackendUserIntents` | none |

### Orderbook

| Hook | Type / Polling |
|---|---|
| `useBackendOrderbook` | Query; `staleTime: 30s` — fresh-window only, no background refetch |

### Money market data

| Hook | Purpose |
|---|---|
| `useBackendMoneyMarketPosition` | User position |
| `useBackendMoneyMarketAsset` | Asset details |
| `useBackendAllMoneyMarketAssets` | All MM assets |
| `useBackendMoneyMarketAssetSuppliers` | Suppliers for an asset |
| `useBackendMoneyMarketAssetBorrowers` | Borrowers for an asset |
| `useBackendAllMoneyMarketBorrowers` | All borrowers |

### Oracle data

| Hook | Purpose |
|---|---|
| `useBackendOracleMarkets` | Candle discovery: quote, intervals, symbols (`staleTime: 60s`) |
| `useBackendOracleCandles` | USD OHLC candles for a symbol over `[from, to)` (`staleTime: 10s`) |

## Swaps API (`sodax.api.swaps`)

Typed React Query wrappers over the backend Swaps API (`sodax.api.swaps.*`), one per endpoint. Distinct from the on-chain `swap/` hooks (`useQuote`/`useStatus`/`useSwap`/…), which drive `sodax.swaps` (the `SwapService`).

### Tokens · quote · fees · gas (reads)

| Hook | Type / Polling |
|---|---|
| `useSwapsApiTokens` | Query; all supported swap tokens by chain |
| `useSwapsApiTokensByChain` | Query; tokens for one chain |
| `useSwapsApiQuote` | Query; solver quote (set `query.includeTxData` for `txData`) |
| `useSwapsApiDeadline` | Query; computed swap deadline |
| `useSwapsApiPartnerFee` | Query; partner fee for an amount |
| `useSwapsApiSolverFee` | Query; protocol (solver) fee for an amount |
| `useSwapsApiEstimateGas` | Query; gas estimate for a raw tx |

### Intent lifecycle (reads)

| Hook | Type / Polling |
|---|---|
| `useSwapsApiAllowance` | Query; `{ valid }` allowance check |
| `useSwapsApiStatus` | Query (1s); polls until status `3` (SOLVED) / `4` (FAILED) |
| `useSwapsApiIntentHash` | Query; keccak256 of an intent struct |
| `useSwapsApiIntentPacket` | Query; long-polls the relayer for the fill packet (no client interval) |
| `useSwapsApiIntentExtraData` | Query; relay extra-data for submit |
| `useSwapsApiFilledIntent` | Query; on-chain fill state by tx hash |
| `useSwapsApiIntent` | Query; decoded intent struct by tx hash |
| `useSwapsApiSubmitTxStatus` | Query (1s); requires `txHash` + `srcChainKey`; polls until `solved` / `failed` |

### Actions (mutations)

| Hook | Type |
|---|---|
| `useSwapsApiApprove` | Mutation; builds unsigned approval tx(s) — `{ tx, resetTx? }`, caller signs |
| `useSwapsApiApproveAndBroadcast` | Mutation; builds **and** signs/broadcasts/waits — preferred; `{ approveTxHash, resetTxHash? }`; optional `onProgress` per step |
| `useSwapsApiCreateIntent` | Mutation; builds `{ tx, intent, relayData }` |
| `useSwapsApiSubmitIntent` | Mutation; submits broadcast intent to the relay |
| `useSwapsApiCancelIntent` | Mutation; builds unsigned cancel tx |
| `useSwapsApiCreateLimitOrder` | Mutation; builds limit-order intent tx |
| `useSwapsApiSubmitTx` | Mutation; `request: SubmitTxRequestV2` |

## Bridge API (`sodax.api.bridge`)

Typed React Query wrappers over the backend Bridge API (`sodax.api.bridge.*`). Distinct from the on-chain `bridge/` hooks (`useBridge`/`useBridgeAllowance`/…), which drive `sodax.bridge` (the `BridgeService`). Smaller than the swaps family (no intent/solver surface). The fee / bridgeable-amount / bridgeable quotes are computable client-side (prefer the on-chain `useGetBridgeableAmount` / `sodax.bridge.*` — no round-trip), but are also mirrored here as HTTP hooks for parity.

| Hook | Type / Polling |
|---|---|
| `useBridgeApiTokens` | Query; all supported bridge tokens by chain |
| `useBridgeApiTokensByChain` | Query; supported bridge tokens for one `chainKey` |
| `useBridgeApiAllowance` | Query; `{ valid }` allowance check (wire-named body) |
| `useBridgeApiFee` | Query; `{ fee }` partner fee for an amount (per-request `partnerFee` override or configured default) |
| `useBridgeApiBridgeableAmount` | Query; `{ limit }` deposit capacity / withdrawal liquidity for a pair |
| `useBridgeApiIsBridgeable` | Query; `{ bridgeable }` whether a (from, to) pair is bridgeable |
| `useBridgeApiSubmitTxStatus` | Query (1s); requires `txHash` + `srcChainKey`; polls until `executed` / `failed` / `abandonedAt`, or the backend rejects the API key |
| `useBridgeApiApprove` | Mutation; builds the unsigned approval txs — `{ tx, resetTx? }`, ordering is yours to handle |
| `useBridgeApiApproveAndBroadcast` | Mutation; builds **and** signs/broadcasts/waits — preferred; `{ approveTxHash, resetTxHash? }`; optional `onProgress` per step |
| `useBridgeApiCreateBridgeIntent` | Mutation; builds `{ tx, relayData }` (no intent) |
| `useBridgeApiSubmitTx` | Mutation; `request: BridgeSubmitTxRequestV2` (FULL relayData envelope) |

## Leverage Yield API (`sodax.api.leverageYield`)

Typed React Query wrappers over the backend Leverage Yield API (`sodax.api.leverageYield.*`), one per endpoint. Distinct from the on-chain `leverageYield/` hooks (`useLeverageYieldDeposit`/`useLeverageYieldWithdraw`/…), which drive `sodax.leverageYield` (the `LeverageYieldService`). A vault deposit/withdraw IS an intent-based swap, so the intent / gas / fee / submit-tx hooks mirror the swaps family; the vault registry, vault reads and the split deposit/withdraw quote + create-intent hooks are leverage-yield's own.

| Hook | Type / Polling |
|---|---|
| `useLeverageYieldApiVaults` | Query; the deployed-vault registry |
| `useLeverageYieldApiVault` | Query; one vault descriptor by lsoda* `name` |
| `useLeverageYieldApiAsset` | Query; the vault's underlying hub asset |
| `useLeverageYieldApiPosition` | Query; `{ collateral, debt, ltv, healthFactor, idleAsset }` as decimal strings (`ltv` bps, `healthFactor` WAD) |
| `useLeverageYieldApiApr` | Query; AAVE-only steady-state APR (RAY strings; can be negative) |
| `useLeverageYieldApiEffectiveApr` | Query; combined AAVE + LSD APR — `effectiveNetAprRay` is the headline |
| `useLeverageYieldApiLsdApr` | Query; off-chain LSD staking-APR snapshot |
| `useLeverageYieldApiTotalAssets` | Query; total assets under management |
| `useLeverageYieldApiPreviewDeposit` | Query; ERC-4626 `previewDeposit` — shares for `assets` |
| `useLeverageYieldApiPreviewWithdraw` | Query; ERC-4626 `previewWithdraw` — shares burned for `assets` |
| `useLeverageYieldApiPreviewRedeem` | Query; ERC-4626 `previewRedeem` — assets for `shares` |
| `useLeverageYieldApiShareBalance` | Query; an owner's lsoda* balance (the HUB wallet, not the EOA) |
| `useLeverageYieldApiMaxWithdraw` | Query; RAW ERC-4626 `maxWithdraw` in ASSET units, NOT dust-trimmed — never a withdraw's `inputAmount`, which is shares; size a MAX withdraw from `useLeverageYieldApiShareBalance` |
| `useLeverageYieldApiDepositQuote` | Query; any token → lsoda* (set `query.includeTxData` for `txData`) |
| `useLeverageYieldApiWithdrawQuote` | Query; lsoda* → any token |
| `useLeverageYieldApiDeadline` | Query; computed vault-swap deadline |
| `useLeverageYieldApiAllowance` | Query; `{ valid }` — the DEPOSIT body only (withdraw needs no spoke allowance) |
| `useLeverageYieldApiStatus` | Query (1s); polls until status `3` (SOLVED) / `4` (FAILED) |
| `useLeverageYieldApiIntentHash` | Query; keccak256 of an intent struct |
| `useLeverageYieldApiIntentPacket` | Query; long-polls the relayer for the fill packet (no client interval) |
| `useLeverageYieldApiIntentExtraData` | Query; relay extra-data for submit |
| `useLeverageYieldApiFilledIntent` | Query; on-chain fill state by tx hash |
| `useLeverageYieldApiIntent` | Query; decoded intent struct by tx hash |
| `useLeverageYieldApiEstimateGas` | Query; gas estimate for a raw tx |
| `useLeverageYieldApiPartnerFee` | Query; partner fee for an amount |
| `useLeverageYieldApiSolverFee` | Query; protocol (solver) fee for an amount |
| `useLeverageYieldApiSubmitTxStatus` | Query (1s); requires `txHash` + `srcChainKey`; polls until `solved` / `failed` / `abandonedAt` |
| `useLeverageYieldApiApprove` | Mutation; builds unsigned approval tx(s) — `{ tx, resetTx? }`, ordering is yours to handle |
| `useLeverageYieldApiApproveAndBroadcast` | Mutation; builds **and** signs/broadcasts/waits — preferred; `{ approveTxHash, resetTxHash? }`; optional `onProgress` per step |
| `useLeverageYieldApiCreateDepositIntent` | Mutation; builds `{ tx, intent, relayData }` (any token → lsoda*) |
| `useLeverageYieldApiCreateWithdrawIntent` | Mutation; builds `{ tx, intent, relayData }` (lsoda* → any token) |
| `useLeverageYieldApiSubmitIntent` | Mutation; submits broadcast intent to the relay |
| `useLeverageYieldApiCancelIntent` | Mutation; builds unsigned cancel tx |
| `useLeverageYieldApiSubmitTx` | Mutation; `request: LeverageYieldSubmitTxRequestV2` — the swaps body PLUS a required `operation: 'deposit' \| 'withdraw'` |

## Partner

| Hook | Type | Purpose |
|---|---|---|
| `useFetchAssetsBalances` | Query | Fetch partner asset balances |
| `useGetAutoSwapPreferences` | Query | Get auto-swap preferences |
| `useIsTokenApproved` | Query | Check token approval |
| `useGetUserIntent` | Query | Look up a partner's stored intent hash for a token pair (`0x0…0` = none) |
| `useGetIntentDetails` | Query | Read full intent details for an intent hash |
| `useApproveToken` | Mutation | Approve token |
| `useSetSwapPreference` | Mutation | Set swap preference |
| `useFeeClaimSwap` | Mutation | Claim partner fees via swap |
| `useFeeClaimWithdraw` | Mutation | Withdraw a fee token directly (no swap) via the bridge |
| `usePartnerCancelIntent` | Mutation | Cancel a stuck same-token claim and recover the locked tokens |

## Recovery

| Hook | Type | Purpose |
|---|---|---|
| `useHubAssetBalances` | Query | Hub asset balances |
| `useWithdrawHubAsset` | Mutation | Withdraw hub asset |

## Shared

| Hook | Type | Purpose |
|---|---|---|
| `useBalances` | Query | SDK-backed wallet token balances (no xService) |
| `useXBalances` | Query | Cross-chain token balances |
| `useDeriveUserWalletAddress` | Query | Derive hub wallet (CREATE3) |
| `useGetUserHubWalletAddress` | Query | Derive hub wallet (wallet router) |
| `useEstimateGas` | Mutation | Estimate gas for raw tx |
| `useStellarTrustlineCheck` | Query | Check Stellar trustline |
| `useEstablishTrustline` | Mutation | Request a Stellar trustline (the account pays — needs XLM) |
| `useRequestTrustline` | Deprecated | 2.0.0-shape wrapper over `useEstablishTrustline`; removed next major |
| `useStellarGate` | Composite | Sequences the Stellar prerequisites: exists → trustline → can afford; `checkFailed`/`error`/`retry` for a failed check |
| `useNearStorageCheck` | Query | Check NEP-141 storage registration (NEAR) |
| `useRegisterNearStorage` | Mutation | Submit NEP-141 `storage_deposit` (NEAR) |
| `useNearStorageGate` | Hook | Composite NEAR receive-side storage gate |
| `resolveNearStorageGate` | Utility | Derive gate flags from a `useNearStorageCheck` result (unwrapped) |
| `useSafeMutation` | Internal | The wrapper every mutation hook calls |
| `unwrapResult` | Internal | `Result<T>` → throw / return |
| `toResult` | Internal | `Promise<T>` → `Result<T>` |

## Sponsoring (`sponsoring/`)

Stellar accounts must exist on-chain before they can hold or receive anything, and a new user holds 0 XLM.
These hooks drive the sponsored-reserve activation flow, where the SODAX sponsor pays the base reserve.

| Hook | Kind | Purpose |
| --- | --- | --- |
| `useStellarAccountActive` | Query | Whether a Stellar account already exists on-chain |
| `useStellarAccountStatus` | Query | Existence + `canAffordTrustline` + `trustlineMinXlmStroops`, from one Horizon account read |
| `useSponsorConfig` | Query | Sponsor account, network, fee band, max time bounds |
| `useActivateStellarAccount` | Mutation | Activate a Stellar account via the sponsor |

## Cross-references

- [`../features/`](../features/) — per-feature reference docs (params types, return shapes, gotchas).
- [`../recipes/`](../recipes/) — copy-paste worked examples per feature.
- [`querykey-conventions.md`](querykey-conventions.md) — queryKey/mutationKey shape rules.
