---
name: sodax-dapp-kit-leverage-yield
description: 'Granular skill for the @sodax/dapp-kit v2 leverage-yield feature only, covering BOTH products: (1) React Query hooks for leveraged-yield ERC-4626 VAULTS on Sonic — useLeverageYieldDeposit and useLeverageYieldWithdraw (build a swap payload), useLeverageYieldVaultSwap (execute it end-to-end), plus reads useLeverageYieldEffectiveApr, useLeverageYieldPosition, useLeverageYieldTotalAssets, useLeverageYieldPreviewRedeem, useLeverageYieldShareBalances; and (2) LEVERAGE POSITIONS — one owner-controlled AAVE account per position, via useOpenLeveragePosition, useSubmitLeveragePositionIntent, useRunLeveragePositionOperation, useApproveLeveragePositionFunding, and the reads useLeveragePositions, useLeveragePositionsForUser, useLeveragePositionInfo, useLeveragePositionAccount, useLeveragePositionCollateral, useLeveragePositionPending, useLeveragePositionPayoutAddress, useLeveragePositionFundingAllowance. Use when a React dapp task is leverage-yield vaults (e.g. "deposit into a leverage vault with dapp-kit", "useLeverageYieldVaultSwap hook", "render vault APR / TVL", "lsoda share balances across chains") OR leverage positions (e.g. "open a leverage position in React", "useOpenLeveragePosition hook", "adjust / increase / decrease leverage", "close a leveraged position", "render position health factor / LTV", "list a user''s leverage positions"). New in v2 — integration only, no v1 migration path. Links into the parent sodax-dapp-kit knowledge tree. For backend/Node, use the sodax-sdk skill.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Leverage Yield (dapp-kit granular skill)

Granular skill for the leverage-yield hooks of `@sodax/dapp-kit` v2. queryKey/mutationKey first segment: `leverageYield`. React-only — backend uses `@sodax/sdk` directly. **New in v2; no v1 migration path.**

## Step 1 — Clarify with user before coding

0. **Vault or leverage position?** Ask first — they share the `leverageYield` key namespace and nothing else. A **vault** is one pooled ERC-4626 position at a single target LTV (`useLeverageYield*`). A **leverage position** is the user's own AAVE account, cloned per position (`useLeveragePosition*`, `useOpenLeveragePosition`). `useLeverageYieldPosition` is the **vault's** snapshot — it is not a leverage position. If the answer is positions, jump to Step 1b.
1. **Deposit or withdraw?** Deposit = any token → `lsoda*` shares (lands in the hub wallet). Withdraw = `lsoda*` shares → any token on any chain.
2. **Build vs execute.** `useLeverageYieldDeposit` / `useLeverageYieldWithdraw` only *build* a `LeverageYieldSwapPayload`; `useLeverageYieldVaultSwap` *executes* it (create → relay → notify solver). You always need both.
3. **Approval?** Deposit approves the spoke `inputToken` via the swap-domain `useSwapApprove` / `useSwapAllowance` (no leverage-yield-specific approve hook). Withdraw needs no approval (`hubWalletSwap: true`).
4. **Which vaults?** No hook — read the registry with `useSodaxContext().sodax.leverageYield.listVaults()` (synchronous, wrap in `useMemo`) and pass each entry's `vault` address to the hooks.
5. **Which reads?** `useLeverageYieldEffectiveApr` (headline APR), `useLeverageYieldPosition` (LTV/health), `useLeverageYieldTotalAssets` (TVL), `useLeverageYieldPreviewRedeem` (price-per-share), `useLeverageYieldShareBalances` (per-chain balances — returns an array).

### Step 1b — leverage positions

1. **Which mutation?** Decided by the operation, not by preference. Open → `useOpenLeveragePosition`. Leverage change (`buildAddLeverage` / `buildDecreaseLeverage`) → `useSubmitLeveragePositionIntent`. Withdraw / settle / cancel → `useRunLeveragePositionOperation`. The first two report the intent; the third has nothing to report, and routing a leverage change through it leaves an intent nothing will fill. TypeScript enforces this via the `PositionIntentCall` / `PositionDirectCall` brands.
2. **Approval?** Gate on `useLeveragePositionFundingAllowance`, approve with `useApproveLeveragePositionFunding` — the spender differs per chain and the SDK resolves it. Nothing is ever approved to the factory.
3. **Sized the leg?** `borrowAmount` / `minCollateralOut` come from `sizeLeverageBorrow` → `getPositionLegQuote` → `projectLeverageLeg`, never oracle parity. Read `ltv` / `liquidationThreshold` from `useEModes` when the position sets an `eModeCategory`.
4. **Which reads?** `useLeveragePositions` / `useLeveragePositionsForUser` (discovery), `useLeveragePositionAccount` (health/LTV), `useLeveragePositionCollateral` (sizes an exit), `useLeveragePositionPending` (is an intent live), `useLeveragePositionInfo` (this position's own `feeBps`), `useLeveragePositionPayoutAddress` (where a withdrawal can pay — **not a query**, returns synchronously).

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/leverage-yield.md`](../integration/knowledge/features/leverage-yield.md) — full hook surface, mutation TVars, read shapes, approval pattern, gotchas.
4. [`../integration/knowledge/recipes/leverage-yield.md`](../integration/knowledge/recipes/leverage-yield.md) — full worked examples (deposit, withdraw, stats, share balances).
   - **Building a user-facing vault screen?** Read [`../integration/knowledge/recipes/leverage-yield-product-anatomy.md`](../integration/knowledge/recipes/leverage-yield-product-anatomy.md) first: the journey, the states to handle, display metadata, USD prices, derived values, units, and the planned steps with explorer links. Layout stays your call.
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Leverage-yield-specific anti-patterns (dapp-kit)

- **Calling `useLeverageYieldDeposit` / `useLeverageYieldWithdraw` and expecting a tx.** They are builders — their `data` is a `LeverageYieldSwapPayload`. Spread it into `useLeverageYieldVaultSwap`'s `mutate` with a `walletProvider` to broadcast.
- **Treating `useLeverageYieldShareBalances` as a single query.** It returns an **array** (one `useQueries` row per holder). Aggregate with `reduce`; the key segment is singular `shareBalance`.
- **Gating withdraw on an allowance check.** Withdraw carries `hubWalletSwap: true` — the hub wallet authorises the share spend via `sendMessage`. Only `deposit` uses `useSwapAllowance` / `useSwapApprove`.
- **Reaching for a `useLeverageYieldApprove` hook.** It doesn't exist — the deposit approves the spoke asset manager, so use the swap-domain hooks.
- **Sending `minOutputAmount: 0n`.** Always derive it from `useLeverageYieldQuote`'s `quoted_amount` minus a slippage tolerance in basis points, and disable the action until the quote is `ok`. A zero minimum accepts any fill.
- **Adding a `partnerFee` nobody asked for.** It is optional and opt-in; leave it out unless the integrator gave you their own receiver. Never copy a fee address from a SODAX demo or doc.
- **Labelling `leverageMultiplierWad` as "Leverage".** It is the borrowed multiple, `targetLTV / (1 − targetLTV)`; exposure is `1 + multiplier`. `targetLtvBps` and `position.ltv` are basis points.
- **Lowering the vault-read intervals.** The APR read alone is six Sonic `eth_call`s per vault per refresh. Keep the hook defaults on vault cards; only override hooks that poll faster than your app's floor (quotes, status, wallet balances).
- **Quoting a vault flow with `useQuote`, or with a different fee.** Size `minOutputAmount` with `useLeverageYieldQuote` on the **gross** `inputAmount` — it deducts the effective leverage-yield fee itself, so netting the amount first deducts it twice. Pass it the same `partnerFee` as `useLeverageYieldDeposit` / `useLeverageYieldWithdraw`, or omit it on both. `useQuote` deducts the *swap* fee instead, and whenever the two fees differ the derived `minOutputAmount` can be unfillable.

### Leverage-position anti-patterns (dapp-kit)

- **Reading `useLeverageYieldPosition` for a leverage position.** That is the **vault's** snapshot. A leverage position's live account is `useLeveragePositionAccount`.
- **Treating a resolved `useOpenLeveragePosition` as an open position.** It resolves when the intent is LIVE. The hook unwraps the SDK `Result`, so check **`result.notified`** on `mutateAsync`'s value (not `result.value.notified`); `false` means nothing will fill it before it expires. Do not retry on it — that opens a second position.
- **Routing a leverage change through `useRunLeveragePositionOperation`.** It does not notify. Leverage changes go through `useSubmitLeveragePositionIntent`; the brands refuse the mistake at compile time, so never cast past them.
- **Calling `notifySolver` yourself after `useSubmitLeveragePositionIntent`.** The hook already reports the intent — read `notified` on its result instead.
- **Awaiting `useLeveragePositionPayoutAddress` like a query.** It is synchronous: `Address | undefined`, no `data` / `isLoading`. Off the hub a withdrawal pays to a hub address that is **not** the signer, which is exactly what it resolves.
- **Sizing an exit from `totalCollateralBase`.** Display-only. Use `useLeveragePositionCollateral` — an over-sized `decreaseLeverage` reverts at fill time and the intent silently expires.
- **Charging an existing position the configured fee.** Read `feeBps` from `useLeveragePositionInfo`; `getEffectivePositionFee()` is what a NEW position would carry.
- **Treating the mutation receipt as completion.** A solver fills a leverage change afterwards — poll `useLeveragePositionPending`.

## Acceptance (what the user can do)

Check the running app against these, not only `pnpm tsc`. The full list is in the product anatomy's Acceptance section.

- Every vault shows its asset, a variable APR (sign kept), TVL in the asset and USD, exposure (`1 + multiplier`) and health.
- Before signing, the user sees what they receive, the minimum they accept, and the steps they will sign.
- Each step links to its transaction on the right explorer, and the flow is followed to a terminal status.
- Shares are shown per network, in the asset and in USD; withdraw is capped at shares and signed from the network that deposited.
- Rejecting in the wallet returns to the form quietly; every other state has a clear message.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Deposit/withdraw build a payload, then `useLeverageYieldVaultSwap` executes it (`{ ...payload, walletProvider }`).
3. `useLeverageYieldShareBalances` consumers treat `data` as an array and aggregate.
4. Every `minOutputAmount` is derived from a live `useLeverageYieldQuote` minus slippage; no `0n`, no unrequested `partnerFee`.
5. Withdraw flows do not gate on `useSwapAllowance`.
6. Mutation flows use `mutateAsyncSafe` and branch on `result.ok`; reads read `data` directly (no `.ok`/`.value`), except `useLeverageYieldQuote` and `useLeverageYieldDetailedStatus`, whose `data` is the SDK `Result` (branch on `data?.ok`).
7. Positions: leverage changes use `useSubmitLeveragePositionIntent` (never `useRunLeveragePositionOperation`), `notified` is checked on every open and leverage change, and exits are sized from `useLeveragePositionCollateral` with the fee from `useLeveragePositionInfo`.
8. Positions: funding is gated on `useLeveragePositionFundingAllowance` + `useApproveLeveragePositionFunding`, and `borrowAmount` / `minCollateralOut` trace back to `sizeLeverageBorrow` + `projectLeverageLeg`.

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — `useSwapApprove` / `useSwapAllowance` (spoke-side deposit approval) live here. Size `minOutputAmount` with `useLeverageYieldQuote`, not the swap skill's `useQuote`.
- [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md) — `useXBalances` / gas-estimation utilities used alongside leverage-yield UI.

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md). The backend REST hooks (`useLeverageYieldApi*`) are a different surface, documented in the Leverage Yield API section of [`../integration/knowledge/features/auxiliary-services.md`](../integration/knowledge/features/auxiliary-services.md) (granular skill: [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md)).

## Wallet connectivity (different SDK package family)

`walletProvider` flows through `mutate(vars)`. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire wallets and get a typed `walletProvider` via `useWalletProvider({ xChainId: chainKey })`.
