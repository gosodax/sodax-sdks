---
'@sodax/types': minor
'@sodax/sdk': minor
'@sodax/dapp-kit': minor
'@sodax/skills': minor
---

Add leverage-position support to the leverage-yield module — the unpooled counterpart to the ERC-4626 vaults, where each position is its own AAVE account so an owner can hold several at different eMode categories and leverage tiers.

`@sodax/types` gains `LeveragePosition`, `LeveragePositionAccount`, `LeveragePositionCollateral`, `LeveragePositionPendingState`, and a `leverageYield.positionFactory` config slot. `LeverageYieldService` gains `listPositions`, `listPositionsForUser`, `getPositionInfo`, `getPositionAccount`, `getPositionCollateralBalance`, `getPositionPendingState` and `predictPosition`, plus raw-transaction builders for create-and-leverage, create-from-debt-token, add, decrease, withdraw, settle and cancel. `@sodax/dapp-kit` gains the matching read hooks.

Positions are driven from any chain, not only the hub: `openPosition` / `openPositionFromDebtToken` carry the deposit and create the position inside the same relayed batch, and `operatePosition` runs the position calls as the user's hub wallet. On the hub these route locally through the wallet router; from a spoke they relay and resolve once the hub side lands. `approvePositionFunding` / `isPositionFundingAllowanceValid` handle the approval, whose spender differs by chain — the hub wallet on the hub, the spoke asset manager elsewhere.

Two things integrators need to know. Position writes are `onlyOwner` against the user's hub wallet, so they must execute *as* that wallet — sending a builder's transaction from the signing address reverts. And a position's leverage calls only *post* an intent, which stays invisible to the solver until its **hub** transaction hash (`dstChainTxHash`, not `srcChainTxHash`) is passed to `notifySolver`, so an unreported one expires unfilled.

Closing into the debt token is `buildDecreaseLeverage` with the position's whole collateral balance, sized by `getPositionCollateralBalance` — the account snapshot's base-currency collateral is display precision and cannot name the amount. The hook repays the debt and leaves the surplus in the position for `buildSettlePosition` to sweep to its owner.

**Off-hub origins are experimental.** Every path is exercised end to end on Sonic, the hub. From a spoke the inbound half is proven only by a fork replay of a real relayed message, and the outbound half — an exit or cancellation delivering the underlying back to the chain it came from — has not run on mainnet. `openPosition` / `openPositionFromDebtToken` / `operatePosition` carry an `@experimental` note for a non-hub `srcChainKey`, and the demo says so when one is selected.

**An optional partner fee.** `PositionConfig` gains `feeReceiver` / `feeBps` (fixed at creation, capped at 1%), and `partnerFee` threads through the create paths with the vault flows' precedence. The SDK rejects a configured or per-call fee above that cap — exported as `MAX_POSITION_FEE_BPS`, mirroring `LeveragePosition.MAX_FEE_BPS` — and rejects a rate without a receiver or a receiver without a rate, before anything is signed rather than as an on-chain revert. Percentage variant only — the contract stores basis points, so a fixed-amount fee is rejected rather than silently dropped. The fee is borrowed on top of what the solver is paid, so it is debt against unchanged collateral: `projectLeverageLeg` takes `feeBps` and the ceiling becomes `1 / (1 + phi - ltv.f)` on the debt side, `1 + ltv / (1 + phi - ltv.f)` on the collateral side. At ltv 91% and f 0.9877 that is 9.88x, 9.42x at 50 bp, 8.99x at 100 bp — ignoring it would put users into Aave `'36'` at leverages the caller was told were safe.

`leverageYield.positionFactory` ships as a packaged default now that the factory is deployed, so positions work from `new Sodax()` with nothing configured; an override is still honoured for a fork or a staging deployment, and blanking it fails closed rather than falling back to a placeholder.

Sizing a position's swap leg also moves into the SDK, as `sizeLeverageBorrow` and `projectLeverageLeg`. Do not compute `borrowAmount` / `minCollateralOut` from oracle prices: the legs do not trade at their oracle ratio, and `LeverageHook` supplies what the solver actually paid before borrowing against it, so parity sizing gets the borrow rejected with Aave `'36'` *after* the solver has filled. The helpers report the floor to post, the position that results from it, the leg's expected cost, and `usableMaxLeverage` — the real ceiling, which is strictly below `1 / (1 - ltv)`.
