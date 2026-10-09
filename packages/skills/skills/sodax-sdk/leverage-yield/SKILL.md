---
name: sodax-sdk-leverage-yield
description: 'Granular skill for the @sodax/sdk v2 leverage-yield feature only, covering BOTH products on LeverageYieldService: (1) leveraged-yield ERC-4626 vaults on Sonic — deposit any token → lsoda* shares, withdraw shares → any token (solver-tradeable intent swaps), createVaultIntent/vaultSwap/notifySolver, approve/isAllowanceValid, and reads (getApr, getEffectiveApr, getPosition, getTotalAssets, preview*, getMaxWithdraw*, getShareBalance*, listVaults); and (2) LEVERAGE POSITIONS — one owner-controlled AAVE account per position cloned by LeveragePositionFactory, via openLeveragePosition / submitLeveragePositionIntent / runLeveragePositionOperation, the openPosition / openPositionFromDebtToken / operatePosition low-level pair, position reads (listPositions, listPositionsForUser, getPositionInfo, getPositionAccount, getPositionCollateralBalance, getPositionPendingState, predictPosition), approvePositionFunding, and leg sizing with sizeLeverageBorrow / projectLeverageLeg / getPositionLegQuote. Use when the task is leverage-yield vaults (e.g. "deposit into a leverage vault", "withdraw lsoda shares", "vault APR / effective APR", "lsoda share balance") OR leverage positions (e.g. "open a leverage position", "adjust / increase / decrease leverage", "close a leveraged position", "position health factor / LTV", "size borrowAmount and minCollateralOut", "leveraged long with my own AAVE account"). New in v2 — integration only, no v1 migration path. Links into the parent sodax-sdk knowledge tree. For React dapps, prefer sodax-dapp-kit.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Leverage Yield (Core SDK granular skill)

Granular skill for `LeverageYieldService` — `sodax.leverageYield`. Feature tag: `'leverageYield'`. **New in v2; no v1 migration path.**

## Step 1 — Clarify with user before coding

0. **Vault or leverage position?** Ask this first — they share the service and nothing else. A **vault** is one pooled ERC-4626 position at a single target LTV, entered/exited as an intent swap (`deposit` / `withdraw` / `vaultSwap`). A **leverage position** is the user's own AAVE account, cloned per position, with its own eMode category and leverage tier (`openLeveragePosition` and friends). "Deposit into a leverage vault" is the first; "open a leverage position", "adjust my leverage", "close my position" is the second. If the answer is positions, jump to Step 1b.
1. **Deposit or withdraw?** Deposit = any spoke token → `lsoda*` shares (delivered to the user's hub wallet). Withdraw = `lsoda*` shares (in the hub wallet) → any token on any chain.
2. **Build vs execute.** `deposit` / `withdraw` only *build* a `LeverageYieldSwapPayload`; `vaultSwap` *executes* it end-to-end. Spread the built payload into `vaultSwap({ ...payload, walletProvider })`.
3. **End-to-end or manual relay?** By default `vaultSwap` creates the intent and hands it to the backend submit-tx flow, which relays and notifies the solver; on any backend non-success it falls back to verify → relay → notify client-side, and then resolves before the fill (opt out of the backend path with `leverageYield: { useBackendSubmitTx: false }`). For a fully manual flow, use `createVaultIntent`, relay yourself, and finish with the public `notifySolver`.
4. **Which vaults?** `listVaults()` (synchronous registry: `{ name, vault, asset, borrowToken, lsdSource? }`); pass `vault` to every call.
5. **Reads?** `getEffectiveApr` (headline, AAVE + LSD), `getApr` (AAVE-only — can be negative), `getPosition`, `getTotalAssets`, `previewRedeem`, `getMaxWithdrawForUser` / `getShareBalanceForUser` (resolve the hub wallet from a spoke address internally).

### Step 1b — leverage positions

1. **Which operation?** It decides the method, and the choice is not stylistic. Open → `openLeveragePosition`. Leverage change (`buildAddLeverage` / `buildDecreaseLeverage`) → `submitLeveragePositionIntent`. Withdraw / settle / cancel → `runLeveragePositionOperation`. The first two report the intent; the third has nothing to report. Sending a leverage change through the route-only path leaves an intent nothing will fill, and it expires without a word — the compiler refuses it via the `PositionIntentCall` / `PositionDirectCall` brands.
2. **Which side funds the open?** `side: 'collateral'` deposits the collateral asset. `side: 'debt'` funds with the debt token and the deposit is **not** collateral — it goes to the solver as part of the input, so the only collateral the position gets is what the solver delivers.
3. **Have you sized the leg?** `borrowAmount` / `minCollateralOut` must come from `sizeLeverageBorrow` → `getPositionLegQuote` → `projectLeverageLeg`. Oracle parity is wrong and fails *after* the solver fills. Never hand-roll it.
4. **Which chain?** Sonic (the hub) is the proven path. A non-hub `srcChainKey` is `@experimental`; Bitcoin is refused outright.

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md).
2. [`../integration/knowledge/features/leverage-yield.md`](../integration/knowledge/features/leverage-yield.md) — `LeverageYieldService` API, the share-as-token model, deposit/withdraw/vaultSwap flows, APR math.
3. Path-specific recipe:
   - Signed → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Unsigned → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md)
4. Errors (`feature: 'leverageYield'`) → [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Leverage-yield-specific anti-patterns

- **Expecting `deposit` / `withdraw` to broadcast.** They are builders returning a `LeverageYieldSwapPayload`. Execute via `vaultSwap({ ...payload, walletProvider })`.
- **Using `getApr` as the headline number.** For LSD-backed vaults the AAVE-only spread is often negative; `getEffectiveApr` folds in the LSD staking yield (the real source of return).
- **Passing a spoke address to `getShareBalance` / `getMaxWithdraw`.** Those take a hub address. Use the `*ForUser(vault, srcChainKey, srcAddress)` variants to resolve the hub wallet first.
- **Gating withdraw on `approve` / `isAllowanceValid`.** Those are Sonic-direct allowance helpers for the vault's underlying asset; the swap-style withdraw authorises the share spend via a hub-wallet `Connection.sendMessage` (`hubWalletSwap: true`).
- **Sending `minOutputAmount: 0n`.** Derive it from `sodax.leverageYield.getQuote`'s `quoted_amount` minus a slippage tolerance in basis points. The SDK does not reject zero, and a zero minimum accepts any fill.
- **Adding a `partnerFee` nobody asked for.** It is optional and opt-in; leave it out unless the integrator gave you their own receiver. Never copy a fee address from a SODAX demo or doc.
- **Reading `leverageMultiplierWad` as total exposure.** It is the borrowed multiple, `targetLTV / (1 − targetLTV)`; exposure is `1 + multiplier`. `targetLtvBps` and `getPosition().ltv` are basis points.
- **Quoting a vault flow through `sodax.swaps.getQuote`.** It deducts the effective *swap* fee, while the vault intent charges the effective *leverage-yield* fee (`leverageYield.partnerFee ?? fee`) — the two disagree whenever the feature fees differ. It can be made to agree by passing the leverage-yield fee explicitly (with a zero fee — `{ address, percentage: 0 }` — where that fee is `undefined`, since an explicit `undefined` falls back to the swap fee), but prefer `sodax.leverageYield.getQuote` (`token_dst` = vault for a deposit, `token_src` = vault for a withdraw).
- **Quoting with a different `partnerFee` than the intent charges.** The fee is deducted from the input before the swap, so the quote is sized on a different net input; when the intent's fee is the larger one, the `minOutputAmount` derived from that quote can't be met and the intent never fills. Pass the same `partnerFee` to `getQuote` and to `deposit()` / `vaultSwap()`, or omit it on both.
- **Assuming `swaps.partnerFee` monetizes vault flows.** It does not — configure `leverageYield.partnerFee` (or the global `fee`).
- **Reporting a vault swap as lost on a post-broadcast failure.** `TX_VERIFICATION_FAILED`, the relay codes and post-execution failures from `vaultSwap` carry `error.context.srcTxHash` — the vault swap may still complete, so keep polling `getDetailedStatus` with it.

### Leverage-position anti-patterns

- **Sizing `borrowAmount` / `minCollateralOut` from oracle prices.** The hook supplies what the solver actually paid and only then borrows against it, so the pool sees `deposit + solver output`, never `deposit × leverage`. Parity sizing is accepted, the solver fills, and the borrow then reverts with Aave `'36'` — unwinding the fill. Use `sizeLeverageBorrow` + `projectLeverageLeg` with a `getPositionLegQuote` between them, and treat `exceedsMaxLtv` as a hard gate.
- **Quoting `borrowAmount` instead of `intentInput`.** On a debt-side open the user's own contribution goes to the solver too, so quoting the borrow alone understates the input.
- **Calling `getQuote` for a position leg.** `getPositionLegQuote` names the hub reserves the intent actually swaps and quotes gross — both details a hand-rolled `getQuote` gets wrong, and both surface only as an unfillable floor. Pass the reserve **address** (`reserve.underlyingAsset`), not the reserve object.
- **Routing a leverage change through `runLeveragePositionOperation`.** It does not notify, so the intent expires unfilled. The brands refuse it at compile time — do not cast past them.
- **Treating a resolved open as an open position.** `openLeveragePosition` resolving means the intent is LIVE. Read `notified` on the value; `false` means nothing will fill it. It is deliberately not an error — retrying would open a second position.
- **Treating the transaction receipt as completion.** `addLeverage` / `decreaseLeverage` are filled by a solver afterwards; poll `getPositionPendingState`.
- **Reporting `srcChainTxHash` to `notifySolver`.** The intent exists in the **hub** transaction — `dstChainTxHash`. They are the same only on the hub.
- **Sizing a transaction from `totalCollateralBase`.** Base-currency figures are display-only; use `getPositionCollateralBalance`. An over-sized `decreaseLeverage` does not fail on submission — it reverts at fill and the intent silently expires.
- **Charging an existing position the configured fee.** `getEffectivePositionFee()` is what a NEW position would carry; an existing one's fee was fixed at creation — read `getPositionInfo`. The fee is given up on top of the solver's payment, so an exit sized at the whole collateral balance cannot settle.
- **Approving the factory.** It pulls from nobody. Funding is a transfer to `predictPosition(...)`; the one real approval has a spender that differs per chain, which `approvePositionFunding` resolves.
- **Passing an `owner`.** There is none — the factory requires `cfg.owner == msg.sender` and the caller is always the funder's own hub wallet.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.leverageYield.<method>(...)` has `if (!result.ok)`.
3. Every `minOutputAmount` comes from `sodax.leverageYield.getQuote` minus slippage; no `0n`, no unrequested `partnerFee`.
4. Deposit/withdraw build a payload that is then run through `vaultSwap` (or `createVaultIntent` + relay + `notifySolver`).
5. APR display uses `getEffectiveApr`; share/withdraw sizing from a spoke address uses the `*ForUser` reads.
6. Positions: every `borrowAmount` / `minCollateralOut` traces back to `sizeLeverageBorrow` + `projectLeverageLeg` (never oracle parity), `exceedsMaxLtv` is checked before posting, and `notified` is read on every open / leverage change.
7. Positions: leverage changes go through `submitLeveragePositionIntent`, not `runLeveragePositionOperation`; `notifySolver` is given `dstChainTxHash`; exits are sized from `getPositionCollateralBalance` and charge the fee from `getPositionInfo`.

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — `vaultSwap` is a leverage-yield copy of the swap intent flow. Quote `minOutputAmount` with `sodax.leverageYield.getQuote`, not the swap skill's `getQuote`.
- [`../recovery/SKILL.md`](../recovery/SKILL.md) — recover stuck hub-wallet assets (including `lsoda*` shares) back to a spoke chain.

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).

Building a user-facing React vault screen? Load the `sodax-dapp-kit` skill's leverage-yield granular skill: its product anatomy covers the journey, the states, USD prices, derived values and the units table.
