# Leverage-Yield Effective APR

How the SDK computes the headline APR for a leverage-yield vault — combining on-chain AAVE rates with the underlying LSD's native staking yield.

## TL;DR

A leverage-yield vault deposits an LSD (weETH, wstETH) into AAVE, borrows ETH against it, swaps the borrowed ETH back to the LSD, and re-deposits — looping to a multiple of the user's principal. Yield comes from three places:

1. **AAVE supply rate** on the collateral leg (paid by other AAVE borrowers).
2. **LSD staking yield** baked into the token price (the LSD appreciates against ETH).
3. The above two **amplified by leverage**, minus the AAVE borrow rate paid on the borrow leg.

The SDK's `getApr()` reads only AAVE rates and misses (2). `getEffectiveApr()` adds the LSD yield from DefiLlama and reports the honest number.

## Formula

```
effectiveSupply = aaveSupply + lsdStaking
spread          = effectiveSupply − aaveBorrow
effectiveNet    = effectiveSupply + leverage × spread

leverage        = targetLTV / (1 − targetLTV)
```

All terms are APRs (annualised, in percent). `targetLTV` comes from the vault contract (`targetLTV()`, returned in basis points), `aaveSupply` / `aaveBorrow` come from the AAVE pool's `getReserveData()`, and `lsdStaking` comes from DefiLlama (see [LSD Source](#lsd-source-defillama)).

## Derivation

The formula is the closed-form limit of the vault's recursive supply→borrow→re-supply loop.

Start with deposit `X` of LSD as collateral:

| Step | Supplied | Borrowed |
|---|---|---|
| 0 | `X` | 0 |
| 1 | `X` | `LTV · X` |
| 2 | `X · (1 + LTV)` | `LTV · X · (1 + LTV)` |
| 3 | `X · (1 + LTV + LTV²)` | `LTV · X · (1 + LTV + LTV²)` |
| ∞ | `X · Σ LTVⁿ = X / (1 − LTV)` | `LTV · X / (1 − LTV) = X · leverage` |

So in the steady state, per `X` of original deposit:

- **Total supplied** = `1 / (1 − LTV) = 1 + leverage`
- **Total borrowed** = `leverage`

Earnings:

```
supply earnings = (1 + leverage) × supplyRate
borrow cost     = leverage × borrowRate

net = (1 + leverage) × supplyRate − leverage × borrowRate
    = supplyRate + leverage × (supplyRate − borrowRate)
```

That last line is the formula. The `+ supplyRate` is your **principal** still earning yield; the `leverage × spread` is the **amplified spread** from the loop.

## The LSD twist

For LSD-backed vaults, the collateral leg earns yield from **two independent sources** that compose linearly:

- **AAVE's `currentLiquidityRate`** for the LSD — depends on who else is borrowing it on AAVE. Often near zero for LSDs because they're not heavily borrowed.
- **The LSD's native staking yield** — the LSD token (weETH, wstETH) appreciates against ETH at the issuer's staking rate. This is *off-chain* yield as far as AAVE is concerned — it doesn't show in `currentLiquidityRate`. It just accrues to the token-price.

So `supplyRate → aaveSupply + lsdStaking`. The formula stays identical, only the supply-side input changes:

```
effectiveNet = (aaveSupply + lsdStaking) + leverage × ((aaveSupply + lsdStaking) − aaveBorrow)
```

When the LSD's staking yield is the dominant component (it usually is), ignoring it makes the headline APR look negative — even when the position is genuinely profitable.

## LSD source: DefiLlama

The SDK fetches `lsdStaking` from DefiLlama's per-pool chart endpoint:

```
GET https://yields.llama.fi/chart/<poolId>
→ { status: 'success', data: [{ timestamp, tvlUsd, apy, apyBase, apyReward, ... }, ...] }
```

`apy` is the **compounded yield including reward tokens** (what the depositor actually earns). The SDK takes `data[data.length - 1].apy` (latest entry) and folds it into the formula above.

Each vault registers a DefiLlama `poolId` in `@sodax/types`:

| Vault | LSD | DefiLlama project | poolId |
|---|---|---|---|
| `lsodaWEETH` | weETH | `ether.fi-stake` | `46bd2bdf-6d92-4066-b482-e885ee172264` |
| `lsodaWSTETH` | wstETH | `lido` (via stETH) | `747c1d2a-c668-4682-b9f9-296708a3dd90` |
| `lsodaJITOSOL` | JitoSOL | `jito-liquid-staking` | `0e7d0722-9054-4907-8593-567b353c0900` |
| `lsodaSUSDS` | sUSDS | `sky-lending` (SSR) | `d8c4eff5-c8a9-46fc-a888-057c4c668e72` |

The endpoint is CORS-enabled (`access-control-allow-origin: *`) so a browser-side dApp can hit it directly — no backend required.

If the live fetch fails, the SDK falls back to a hardcoded `fallbackAprPct` in the same registry entry and flags the response with `stale: true` so the UI can show the value as an estimate.

## Worked example

A snapshot of the weETH vault at the moment of writing:

| Term | Value | Source |
|---|---|---|
| `aaveSupply` (weETH vault) | 0.00% | AAVE `getReserveData(asset).currentLiquidityRate` |
| `lsdStaking` (weETH) | 2.92% | DefiLlama pool `46bd2bdf-…`, latest `apy` |
| `effectiveSupply` | 0.00 + 2.92 = **2.92%** | sum |
| `aaveBorrow` (sodaETH) | 1.04% | AAVE `getReserveData(borrowToken).currentVariableBorrowRate` |
| `spread` | 2.92 − 1.04 = **1.88%** | difference |
| `targetLTV` | 85.00% | vault contract `targetLTV()` |
| `leverage` | 0.85 / 0.15 = **5.67×** | derived |
| `leverage × spread` | 5.67 × 1.88 = **10.66%** | multiplication |
| **`effectiveNet`** | 2.92 + 10.66 = **13.58%** | final |

For comparison, the **AAVE-only** number (what `getApr()` returns, ignoring the LSD's staking yield) on the same vault is:

```
aaveOnlyNet = 0% + 5.67 × (0% − 1.04%) = −5.90%
```

The 19.5-percentage-point gap between `effectiveNet` and `aaveOnlyNet` is **the whole reason these vaults exist**: it's the LSD's staking yield multiplied by leverage.

## Code references

- Formula implementation: [`LeverageYieldService.getEffectiveApr`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/leverageYield/LeverageYieldService.ts) (`packages/sdk/src/leverageYield/LeverageYieldService.ts`)
- LSD fetcher: `fetchDefillamaApr` in the same file
- AAVE-only calculation: `LeverageYieldService.getApr` (also same file)
- Vault registry (with `lsdSource.poolId`): [`packages/types/src/leverageYield/leverageYield.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/types/src/leverageYield/leverageYield.ts)

## Caveats

- **Steady-state, not realised**: this is the APR a position earns *at* `targetLTV` if rates stay constant. Realised APY depends on rebalance cadence, rate volatility, and how long the vault sits off-target.
- **`lsdStaking` is a moving average**: DefiLlama publishes the trailing yield, typically a 7- to 30-day window. Spot yield can differ by a few bp.
- **Vault drift**: if `position.ltv` < `targetLTV`, the actual position is under-leveraged and earns less than the headline number. Watch `LeverageYieldService.getPosition()` for the live LTV.
- **Negative spread case**: if `aaveBorrow > effectiveSupply`, leverage *amplifies the loss*. The formula handles this correctly (`effectiveNet` goes negative) — it's a real signal, not a bug.
