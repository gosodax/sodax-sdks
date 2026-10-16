# Leverage Yield — `@sodax/dapp-kit`

Leveraged-yield ERC-4626 vaults on the Sonic hub. Deposit any token → `lsoda*` vault shares, withdraw shares → any token; plus vault-position / APR / TVL / share-balance reads. New in v2 (no v1 equivalent).

> **Vaults and leverage positions are two different products on one hook namespace.** Everything up to "Leverage positions" below is the pooled ERC-4626 **vault** (`useLeverageYield*`). The `useLeveragePosition*` / `useOpenLeveragePosition` hooks drive **leverage positions** — one AAVE account per position. Do not mix the two: `useLeverageYieldPosition` is the vault's snapshot, not a leverage position's.

> **Backend-API variant:** the hooks below drive the on-chain `LeverageYieldService` (wallet → hub). To call the backend **Leverage Yield API** HTTP client (`sodax.api.leverageYield`) directly instead, use the `useLeverageYieldApi*` hooks — typed React Query wrappers over each endpoint (`useLeverageYieldApiVaults`, `useLeverageYieldApiEffectiveApr`, `useLeverageYieldApiDepositQuote` / `useLeverageYieldApiWithdrawQuote`, `useLeverageYieldApiAllowance` / `useLeverageYieldApiApprove`, `useLeverageYieldApiCreateDepositIntent` / `useLeverageYieldApiCreateWithdrawIntent`, `useLeverageYieldApiSubmitTx` / `useLeverageYieldApiSubmitTxStatus`, and the intent-lifecycle/vault-read hooks). Their `queryKey`/`mutationKey` namespace is `leverageYieldApi`. For the endpoint contract, load the `sodax-sdk` skill's leverage-yield-api feature doc.

## Hook surface

```ts
// @ai-snippets-skip
// Mutations
useLeverageYieldDeposit({ mutationOptions });   // build a deposit payload (any token → lsoda*)
useLeverageYieldWithdraw({ mutationOptions });  // build a withdraw payload (lsoda* → any token; hubWalletSwap)
useLeverageYieldVaultSwap({ mutationOptions });  // EXECUTE the built payload end-to-end
useLeverageYieldNotifySolver({ mutationOptions }); // manual-flow: notify the solver after a self-driven relay

// Reads
useLeverageYieldDetailedStatus({ params, queryOptions }); // track a vault swap from its SOURCE tx (3s)
useLeverageYieldQuote({ params, queryOptions });          // vault deposit/withdraw quote (3s) — NOT useQuote
useLeverageYieldEffectiveApr({ params, queryOptions });  // AAVE + LSD effective net APR (60s)
useLeverageYieldPosition({ params, queryOptions });      // collateral/debt/ltv/healthFactor/idle (30s)
useLeverageYieldTotalAssets({ params, queryOptions });   // vault TVL, 18-dp bigint (60s)
useLeverageYieldPreviewRedeem({ params, queryOptions }); // assets for N shares; price-per-share (60s)
useLeverageYieldShareBalances({ params, queryOptions }); // per-chain share balances via useQueries (15s)

// Vault registry — no hook; static SDK config, read synchronously
const { sodax } = useSodaxContext();
const vaults = useMemo(() => sodax.leverageYield.listVaults(), [sodax]); // { name, vault, asset, borrowToken, lsdSource? }[]
```

Every read and builder takes the vault's `vault` field (the `lsoda*` proxy address). `useLeverageYieldApiVaults` is the backend REST equivalent of `listVaults()`. For symbols, logos, USD prices and a single units table, see [`../recipes/leverage-yield-product-anatomy.md`](../recipes/leverage-yield-product-anatomy.md).

`deposit` / `withdraw` are **builders** — they assemble a `LeverageYieldSwapPayload`, they do NOT broadcast. Spread the built payload into `useLeverageYieldVaultSwap`'s `mutate`, adding the `walletProvider`. `vaultSwap` takes the **backend submit-tx** path by default and falls back to the client-side relay on any non-success, so track the result with `useLeverageYieldDetailedStatus` — it keys on the source tx and answers for whichever path completed. Pass `extras.apiKey` in `mutate` to key the backend leg per action. There is no dedicated leverage-yield approve hook: the swap-style deposit approves the spoke-side asset manager, so reuse `useSwapApprove` / `useSwapAllowance` (see Approval pattern).

`use*Approve` is unchanged and still resolves to one transaction hash, but the SDK may send **two**
transactions on a token that rejects a non-zero to non-zero allowance change (Ethereum USDT today) —
the user signs twice and the hash is the **last** one's. An `isPending`-driven "Approving…" should say
so. See "Approve hooks can prompt the wallet twice" in [`architecture.md`](../architecture.md).

## Mutation TVars

```ts
// @ai-snippets-skip
// deposit — vars are the SDK's deposit params (any token → lsoda* on the hub wallet)
type UseLeverageYieldDepositVars = LeverageYieldSwapDepositParams;
//   { vault: Address; srcChainKey; srcAddress; inputToken; inputAmount: bigint;
//     minOutputAmount: bigint; deadline?: bigint; solver?: Address; partnerFee? }

// withdraw — lsoda* shares → any token on any chain (hub-wallet sourced)
type UseLeverageYieldWithdrawVars = LeverageYieldSwapWithdrawParams;
//   { vault: Address; srcChainKey; srcAddress; dstChainKey; outputToken;
//     inputAmount: bigint; minOutputAmount: bigint; recipient?; deadline?; solver? }

// vaultSwap — the executor. Spread the built payload + walletProvider.
type UseLeverageYieldVaultSwapVars<K> = Omit<VaultSwapActionParams<K, false>, 'raw'>;
//   = SpokeExecActionParams<K, false, CreateIntentParams<K>> & { hubWalletSwap?; partnerFee? }
//   i.e. { params: CreateIntentParams<K>; walletProvider; hubWalletSwap?; partnerFee?; timeout? }

// notifySolver — manual-flow notify step (vaultSwap already notifies internally)
type UseLeverageYieldNotifySolverVars = SolverExecutionRequest;
//   { intent_tx_hash: Hex }  — the hub-side tx hash where the intent landed
```

## Read shapes (key picks)

```ts
// @ai-snippets-skip
// useLeverageYieldEffectiveApr — AAVE rates + LSD staking yield, leverage re-applied (data unwrapped)
useLeverageYieldEffectiveApr({ params: { vault } })
//   → UseQueryResult<LeverageYieldEffectiveApr>
//   LeverageYieldEffectiveApr = LeverageYieldApr & { lsdApr, effectiveSupplyAprRay, effectiveNetAprRay }
//   LeverageYieldApr = { supplyAprRay, borrowAprRay, targetLtvBps, leverageMultiplierWad, netAprRay }
//   rates RAY (1e27); targetLtvBps basis points (8_200 = 82%); leverageMultiplierWad WAD (1e18) and the
//   BORROWED multiple, targetLTV / (1 − targetLTV) — total exposure is 1 + multiplier

// useLeverageYieldPosition — live position snapshot
useLeverageYieldPosition({ params: { vault } })
//   → UseQueryResult<LeverageYieldPosition>
//   LeverageYieldPosition = { collateral, debt, ltv, healthFactor, idleAsset } (all bigint)
//   ltv basis points (10_000 = 100%); healthFactor WAD; amounts 18 dp

// useLeverageYieldPreviewRedeem — assets per shares; pass 1e18 for price-per-share
useLeverageYieldPreviewRedeem({ params: { vault, shares: 10n ** 18n } })
//   → UseQueryResult<bigint>

// useLeverageYieldShareBalances — returns an ARRAY (one query per holder), NOT a single result
useLeverageYieldShareBalances({ params: { vault, holders } })
//   → UseQueryResult<LeverageYieldShareHolding>[]
//   LeverageYieldShareHolding = { chainKey: SpokeChainKey; holder: Address; shares: bigint }
//   holders: { chainKey: SpokeChainKey; address: string }[]  — one row per chain the user may hold under
```

## Approval pattern

Leverage-yield has **no dedicated approve hook**. A deposit is a swap-style intent that bridges `inputToken` from the spoke chain, so it approves the spoke-side asset manager exactly like a swap — reuse the swap hooks. A withdraw needs no spoke-side approval: the payload carries `hubWalletSwap: true` and `vaultSwap` authorises the hub wallet to spend the `lsoda*` shares via a `Connection.sendMessage` the user signs on `srcChainKey`.

| Flow | Token approved | Hook |
|---|---|---|
| `deposit` | spoke `inputToken` → asset manager | `useSwapApprove`, `useSwapAllowance` (swap domain) |
| `withdraw` | none (hub-wallet `sendMessage` authorises the spend) | — |

## Return shapes

Read hooks here are **already unwrapped** — they throw on SDK `!ok` so `isError` / `error` / `retry` engage. Read `data` directly; do NOT branch on `data.ok`. **Two hooks are the exception** and return the SDK `Result` as `data`:

- `useLeverageYieldQuote`, matching `useQuote` on the swap side, because a quote failure ("no path", thin liquidity) is an expected UI branch and the `Result` preserves the solver's `detail.code`.
- `useLeverageYieldDetailedStatus`, matching `useDetailedStatus`, because a lookup miss is an expected state while a vault swap is in flight. Narrow `data?.ok`, then `data.value.source` (`'backend'` | `'solver'`); on `!ok`, `error.context.reason` separates the ambiguous not-yet-delivered miss from a failing dependency.

Branch on `data?.ok` for those two hooks only.

| Hook | Returns |
|---|---|
| `useLeverageYieldQuote` | `UseQueryResult<Result<SolverIntentQuoteResponse, SolverErrorResponse \| LeverageYieldLookupError> \| undefined, Error>` (Result **not** unwrapped; `undefined` while `payload` is undefined). Guard the error with `isSodaxError` — the `SolverErrorResponse` arm has `detail.code`, the `SodaxError` arm has `.code` (`VALIDATION_FAILED` / `LOOKUP_FAILED` / `UNKNOWN`) |
| `useLeverageYieldDeposit` / `useLeverageYieldWithdraw` | `SafeUseMutationResult<LeverageYieldSwapPayload, Error, …>` (builder — `data` is the payload to spread into `useLeverageYieldVaultSwap`) |
| `useLeverageYieldVaultSwap` | `SafeUseMutationResult<VaultSwapResponse, Error, …>` (`{ solverExecutionResponse, intent, intentDeliveryInfo }`) |
| `useLeverageYieldDetailedStatus` | `UseQueryResult<Result<DetailedLeverageYieldStatus, LeverageYieldDetailedStatusError> \| undefined>` — Result-wrapped, narrow the value on `source` (`'backend'` \| `'solver'`) |
| `useLeverageYieldNotifySolver` | `SafeUseMutationResult<SolverExecutionResponse, Error, …>` (`{ answer: 'OK', intent_hash }`) |
| `useLeverageYieldEffectiveApr` | `UseQueryResult<LeverageYieldEffectiveApr, Error>` |
| `useLeverageYieldPosition` | `UseQueryResult<LeverageYieldPosition, Error>` |
| `useLeverageYieldTotalAssets` | `UseQueryResult<bigint, Error>` |
| `useLeverageYieldPreviewRedeem` | `UseQueryResult<bigint, Error>` |
| `useLeverageYieldShareBalances` | `UseQueryResult<LeverageYieldShareHolding, Error>[]` (array — one entry per holder) |

## Gotchas

1. **`deposit` / `withdraw` are builders, not executors.** Their `data` is a `LeverageYieldSwapPayload` — spread it into `useLeverageYieldVaultSwap`'s `mutate` with a `walletProvider` to actually run the swap. Calling them does not broadcast anything.
2. **`useLeverageYieldShareBalances` returns an ARRAY, not a single query.** It fans out one `useQueries` row per holder. Aggregate yourself: `balances.reduce((acc, q) => acc + (q.data?.shares ?? 0n), 0n)`. `queryOptions` is spread into every per-holder query (no top-level options slot on `useQueries`).
3. **The share-balance key segment is singular: `shareBalance`** (`['leverageYield', 'shareBalance', vault, chainKey, address]`) — one per holder, even though the hook name is plural.
4. **Withdraw needs no spoke approval.** Don't gate it on `useSwapAllowance` — the hub-wallet `sendMessage` path approves the share spend internally. Only `deposit` needs the swap-domain allowance/approve pair.
5. **Quote vault flows with `useLeverageYieldQuote`, never `useQuote`.** `useQuote` deducts the effective *swap* fee (`swaps.partnerFee ?? fee`) while a vault intent charges the effective *leverage-yield* fee (`leverageYield.partnerFee ?? fee`) — they disagree whenever the two feature fees differ, and when the leverage-yield one is larger the `minOutputAmount` you derive is unfillable and the intent never settles. Pass the same per-intent `partnerFee` to `useLeverageYieldQuote` and to `useLeverageYieldDeposit` / `useLeverageYieldVaultSwap`, or omit it on both — either way the two sides resolve the same fee.
6. **`useLeverageYieldVaultSwap` invalidates xBalances on both chains** (`['shared', 'xBalances', srcChainKey]` and `dstChainKey`) on success. Compose your own `onSuccess` after the hook's — it runs first.
7. **`useLeverageYieldNotifySolver` is for the manual flow only.** `useLeverageYieldVaultSwap` already notifies the solver internally — only reach for the standalone notify hook when you built the intent with `sodax.leverageYield.createVaultIntent` and relayed it yourself. It does NOT invalidate any queries: its only var is `{ intent_tx_hash }` (no chain context), and the fill lands asynchronously afterward.
8. **Never send `minOutputAmount: 0n`.** Size it from `useLeverageYieldQuote`'s `quoted_amount` minus a slippage tolerance in basis points, and keep the deposit disabled until the quote is `ok`. A zero minimum accepts any fill.
9. **Show "Leverage" as `1 + leverageMultiplierWad`.** The multiplier is the borrowed multiple (4.56× at an 82% target LTV); the exposure a depositor holds is 5.56×.
10. **Don't shorten the vault-stat intervals.** One `useLeverageYieldEffectiveApr` refresh is six Sonic `eth_call`s plus a DefiLlama fetch per vault, with no multicall. A grid of vault cards on the defaults is already the heavy part of the page.

## Leverage positions (separate from vaults)

A vault is one shared ERC-4626 position at a single target LTV. A **leverage position** is one AAVE account per position, cloned by `LeveragePositionFactory`, so an owner can hold several at different eMode categories and leverage tiers at once. Different hooks, different reads — `useLeverageYieldPosition` is the **vault's** snapshot and is unrelated to `useLeveragePosition*`.

> **`@experimental` off the hub.** Position writes are proven end to end on Sonic only; from a spoke the inbound half is verified by a fork replay and the outbound half has never run on mainnet. **Bitcoin is refused outright** — a Bitcoin `srcChainKey` returns `VALIDATION_FAILED` rather than funding the wrong hub wallet. The deployed `positionFactory` ships as a packaged default, so positions work from `new Sodax()` with no configuration.

```ts
// @ai-snippets-skip
// Reads — data already unwrapped, read it directly
useLeveragePositions({ params: { owner } });                       // readonly Address[]  key: ['leverageYield','positions',owner]
useLeveragePositionsForUser({ params: { spokeChainKey, spokeAddress } }); // same, via the hub wallet — note spoke*, NOT src*
useLeveragePositionInfo({ params: { position } });                 // LeveragePosition — static descriptor
useLeveragePositionAccount({ params: { position } });              // LeveragePositionAccount (30s)
useLeveragePositionCollateral({ params: { position, collateral } });// LeveragePositionCollateral (30s)
useLeveragePositionPending({ params: { position } });              // LeveragePositionPendingState (15s)
useLeveragePositionFundingAllowance({ params: { srcChainKey, srcAddress, token, amount } }); // boolean

// NOT a query — returns synchronously, no data/isLoading
useLeveragePositionPayoutAddress({ params: { chainKey, signerAddress, owner } }); // Address | undefined

// Mutations
useOpenLeveragePosition();          // key: ['leverageYield','openPosition']         → LeveragePositionIntentResult
useSubmitLeveragePositionIntent();  // key: ['leverageYield','submitPositionIntent'] → LeveragePositionIntentResult
useRunLeveragePositionOperation();  // key: ['leverageYield','runPositionOperation'] → TxHashPair
useApproveLeveragePositionFunding();// key: ['leverageYield','approvePositionFunding']
```

| Type | Fields |
|---|---|
| `LeveragePosition` | `{ address, owner, collateral, borrowToken, eModeCategory, feeBps, feeReceiver }` |
| `LeveragePositionAccount` | `{ totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor }` — bigint; `healthFactor` is WAD, `*Base` is the oracle's 8-dp unit |
| `LeveragePositionCollateral` | `{ aToken, balance }` |
| `LeveragePositionPendingState` | `{ kind: number, isLive: boolean, needsSettle: boolean }` |
| `LeveragePositionIntentResult` | `{ txHashes: TxHashPair, notified: boolean, notifyError?: string }` |

### Which mutation — decided by the operation, not by preference

`addLeverage` / `decreaseLeverage` only **post** a solver intent, and an intent the solver was never told about expires unfilled — leaving the owner funded with leverage that never arrives. `withdraw`, `settle` and `cancel` are synchronous on the hub and need no notification.

| operation | hook | notifies |
|---|---|---|
| open (collateral or debt side) | `useOpenLeveragePosition` | yes |
| `buildAddLeverage` / `buildDecreaseLeverage` | `useSubmitLeveragePositionIntent` | yes |
| `buildPositionWithdraw` / `buildSettlePosition` / `buildCancelPositionOperation` | `useRunLeveragePositionOperation` | no |

TypeScript enforces the rows: the first two builders return `PositionIntentCall`, the last three `PositionDirectCall`, and each hook accepts only its own.

### Position gotchas

1. **Resolving ≠ the position is open.** The mutations unwrap the SDK `Result`, so `mutateAsync` gives you `LeveragePositionIntentResult` directly — check **`result.notified`** (not `result.value.notified`, which is the SDK-level shape). `false` means the intent is live but nothing will fill it before it expires. A failed notification deliberately still resolves: the money has moved, and a caller that retried on failure would open a second position.
2. **`useLeverageYieldPosition` is the VAULT, not a leverage position.** Reading vault LTV/health for a position, or vice versa, silently shows the wrong numbers.
3. **`useLeveragePositionPayoutAddress` is not a query.** It returns `Address | undefined` synchronously — no `data`, no `isLoading`. Off the hub a withdrawal pays to an address on the hub, which is **not** the signer, and this is what resolves it.
4. **Size an exit from `useLeveragePositionCollateral`, never from `totalCollateralBase`.** The base-currency figures are display-only; dividing one back out by a price lands *near* the balance, and a `decreaseLeverage` asking for more than the position holds reverts at fill time and the intent silently expires.
5. **Fees come from `useLeveragePositionInfo` for an existing position.** `getEffectivePositionFee()` is what a NEW position would carry; a position's fee is fixed at creation, so the two disagree once config changes.
6. **Approve with `useApproveLeveragePositionFunding`, gated on `useLeveragePositionFundingAllowance`.** The spender differs per chain — the hub wallet on Sonic, the spoke asset manager elsewhere — so a hand-rolled approval picks the wrong one half the time. Nothing is ever approved to the factory.
7. **Poll `useLeveragePositionPending`, don't trust the receipt.** A leverage change is filled by a solver afterwards, and a position refuses a second operation while one is in flight.
8. **Size the leg with `sizeLeverageBorrow` + `projectLeverageLeg`, never oracle parity.** The hook borrows against what the solver actually paid, so parity sizing gets the borrow rejected with Aave `'36'` after the fill. `exceedsMaxLtv` is a hard gate. Display `exposureLeverage`, not the leverage the user chose — the position reports more. Read `ltv` / `liquidationThreshold` from `useEModes` whenever the position sets an `eModeCategory`. Full treatment in [`../recipes/leverage-yield.md`](../recipes/leverage-yield.md).

## Cross-references

- [`../recipes/leverage-yield.md`](../recipes/leverage-yield.md) — full worked deposit / withdraw / reads examples.
- For the underlying SDK leverage-yield surface (`LeverageYieldService`, `createVaultIntent`, `notifySolver`, APR math), load the `sodax-sdk` skill (integration mode) — its `features/leverage-yield.md`.
