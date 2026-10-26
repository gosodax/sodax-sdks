# Leverage-yield vault app — product anatomy

What a user-facing vault screen has to let people **answer and do**, which hook answers it, the
states to handle, and how to derive the numbers people read. It describes structure, not layout:
grid or list, modal or page, tabs, and where risk copy sits are the builder's call.

Vaults only. Leverage positions are a different product (see [`../features/leverage-yield.md`](../features/leverage-yield.md) § Leverage positions).
Call shapes for every hook here are in [`leverage-yield.md`](leverage-yield.md).

## The journey

| Step | The user must be able to answer | Source |
|---|---|---|
| **Discover** | Which vaults exist, and what each one holds | `sodax.leverageYield.listVaults()` (no hook; see [Display metadata](#display-metadata)) |
| **Evaluate** | What does it earn (and can that change)? How big is it? How much leverage and how healthy? What is one share worth? | `useLeverageYieldEffectiveApr`, `useLeverageYieldTotalAssets`, `useLeverageYieldPosition`, `useLeverageYieldPreviewRedeem`, USD via `useReservesUsdFormat` |
| **Deposit** | From which network and token? What will I receive, and what is the least I accept? Which steps will I sign? | `useLeverageYieldQuote` (vault as `token_dst`), `useSwapAllowance`, `useXBalances` |
| **Track** | Where is my deposit now, and where can I see each transaction? | `useLeverageYieldDetailedStatus`, [explorer links](#planned-steps-and-explorer-links) |
| **Hold** | How many shares do I have, on which network, and what are they worth in the asset and in USD? What might they earn? | `useLeverageYieldShareBalances`, `useLeverageYieldPreviewRedeem`, [derived values](#derived-values) |
| **Withdraw** | How much can I take out, to which token and network, and what is the least I accept? | share balance, `useLeverageYieldQuote` (vault as `token_src`), `useLeverageYieldWithdraw` |

## Concepts users get wrong

- **Shares are not in the wallet extension.** They live in the user's SODAX hub wallet on Sonic, and there is one hub wallet per source network **and** address. Depositing from Base and from Arbitrum makes two separate share balances. A withdraw spends the shares of the hub wallet it is signed for, so it must be signed on the network, from the address, that deposited. Show balances per network (`useLeverageYieldShareBalances` takes one holder per network).
- **The APR is a variable estimate.** `effectiveNetAprRay` is steady-state: it assumes today's rates hold and the vault stays at its target LTV. It can go negative when borrowing costs more than the supply side earns. `lsdApr.stale === true` means the staking part is a fallback figure, so label it as an estimate.
- **Leverage multiplies risk too.** Show exposure as `1 + leverageMultiplierWad` (see [Units](#units)); the multiplier alone is the borrowed part. The health factor is the vault's, not the user's.
- **A deposit is an intent, not a transfer.** The user signs on their network, SODAX delivers it to Sonic, and a solver fills it. There are no partial fills: an intent whose minimum can no longer be met is not filled, and it expires at its deadline (by default five minutes after the hub block time when it was built). `useLeverageYieldDetailedStatus` then answers from the solver (`FAILED` is status `4`) or keeps reading not-found and stops polling after 40 such reads; give the user a timeout of your own rather than waiting forever. When `vaultSwap` took the backend path (the default), the backend's own record (`userMessage`, `failureReason`, and `relayedForRefundAt` once an expired intent was relayed for refund) is readable with `useLeverageYieldApiSubmitTxStatus` from the source tx and `srcChainKey`: the detailed status routes a failed or abandoned backend record to the solver instead of returning it. Don't promise where or when a refund lands; show the status and, if assets are left in the hub wallet, offer the recovery hooks (`useHubAssetBalances`, `useWithdrawHubAsset`, in [`../features/auxiliary-services.md`](../features/auxiliary-services.md)).

## States

Handle every row; how each one looks is up to the builder.

| State | Detect it with | What the user needs |
|---|---|---|
| No quote yet / amount empty | `useLeverageYieldQuote` `data === undefined` | The action disabled, with the reason |
| Amount too low, too high, **or** no route | quote `data.ok === false`, `!isSodaxError(data.error)` and `isNoRouteRefusal(data.error)` | The solver answers all three the same way. Re-quote a mid-size amount to tell them apart: suggest a larger amount only when the refused one was below it, a smaller one only when it was above; otherwise "no route right now, try again shortly" |
| Other solver refusal | quote `!ok`, not a `SodaxError`: `data.error.detail.code` (`SolverIntentErrorCode`) | The solver's message and a retry |
| Invalid input | quote `!ok`, `isSodaxError(data.error)` with `code === 'VALIDATION_FAILED'` | Which input to fix |
| Quote moved | The quote refreshes every 3s | The minimum recomputed on every refresh, and the amounts shown again right before signing |
| Needs approval | `useSwapAllowance` → `false` (deposits only) | An approve step before the deposit step |
| Approval takes two prompts | Some tokens (Ethereum USDT today) need `approve(0)` first; the hook still returns one hash | A note that the wallet may ask twice |
| Wrong network | `useEvmSwitchChain` → `isWrongChain` (load the `sodax-wallet-sdk-react` skill) | A switch-network action instead of the deposit button |
| Not enough balance or gas | No dedicated error code: compare against `useXBalances` before signing | The shortfall, before they sign |
| Would revert on the hub | `vaultSwap` simulates the hub-side execution (not for a Sonic source) and fails with `INTENT_CREATION_FAILED`, the RPC revert as `cause` | That the deposit would fail, before they sign |
| User rejected in the wallet | `isUserRejectedError(result.error)` | Back to the form silently; not an error toast |
| In flight | `useLeverageYieldDetailedStatus` → `data.ok` with a non-terminal status; `!ok` with `error.context.reason === DETAILED_STATUS_NOT_DELIVERED` means not delivered yet | The current step, and that it is safe to wait |
| Filled | backend `data.value.data.status === 'solved'`, or solver `data.value.data.status === 3` | Shares shown (they arrive in the hub wallet) |
| Failed or expired | solver `data.value.data.status === 4` (a failed or abandoned backend record is routed to the solver), or still not found after your own timeout. For `userMessage` / `failureReason` on the backend path, read `useLeverageYieldApiSubmitTxStatus` | What happened and where the funds are, per [Concepts](#concepts-users-get-wrong) |
| Withdraw more than held | Cap `inputAmount` at the share balance. `getMaxWithdraw*` is in **asset** units, not shares | A max button sized from shares |

## Planned steps and explorer links

Show the steps before the user signs, then mark each one as it completes. Explorer URL: `baseChainInfo[chainKey].explorer.txUrl + hash`. There is no SDK URL helper.

| Deposit step | Transaction | Link on |
|---|---|---|
| 1. Approve (only if `useSwapAllowance` is `false`; may be two prompts) | the approve hash | the source network |
| 2. Sign the deposit on the source network | `intentDeliveryInfo.srcTxHash` | the source network |
| 3. Deliver to Sonic | `intentDeliveryInfo.dstTxHash` (equals `srcTxHash` when the source is Sonic) | Sonic |
| 4. Solver fills; shares land in the hub wallet | `result.fillTxHash` on the backend status, or `fill_tx_hash` on the solver status. It may be absent even when filled | the fill's destination network: Sonic for a deposit |

A withdraw has no approve step: 1. sign on the network that deposited, 2. deliver to Sonic, 3. solver fills and pays out on `dstChainKey`. `useLeverageYieldVaultSwap` can resolve before the fill on its client-side fallback path, so keep polling `useLeverageYieldDetailedStatus` until a terminal status.

## Display metadata

The registry entry has no symbol or logo. Both the `lsoda*` share token and the vault's asset are in the hub token config, so resolve them by address and take the logo from the symbol:

```tsx
import { useMemo } from 'react';
import { tokenLogo, useSodaxContext, type LeverageYieldVault } from '@sodax/dapp-kit';

function useVaultDisplay(vault: LeverageYieldVault) {
  const { sodax } = useSodaxContext();
  return useMemo(() => {
    const share = sodax.config.getXTokenFromHubAsset(vault.vault); // lsoda* symbol + decimals
    const asset = sodax.config.getXTokenFromHubAsset(vault.asset); // underlying symbol, e.g. weETH
    return {
      shareSymbol: share?.symbol ?? vault.name,
      assetSymbol: asset?.symbol,
      assetDecimals: asset?.decimals ?? 18,
      logo: tokenLogo(asset?.symbol ?? vault.name),
    };
  }, [sodax, vault]);
}
```

`tokenLogo(symbol)` serves the `@sodax/assets` PNGs; both the `lsoda*` and the underlying logos exist. Pick one per screen and keep it consistent.

## USD prices

Use one source: the money-market reserve prices. Every vault asset is a money-market reserve, keyed by `underlyingAsset`, which equals `vault.asset`. One `useReservesUsdFormat` call prices every vault.

```tsx
import { useReservesUsdFormat } from '@sodax/dapp-kit';

function useAssetUsdPrice(asset: string): number | undefined {
  const { data: reserves } = useReservesUsdFormat();
  const reserve = reserves?.find((r) => r.underlyingAsset.toLowerCase() === asset.toLowerCase());
  return reserve ? Number(reserve.priceInUSD) : undefined; // USD per whole token, from the pool oracle
}
```

USD figures are for display only. Never size `minOutputAmount` from them: that comes from the quote.

## Derived values

```ts
import { formatUnits } from 'viem';

const WAD = 10n ** 18n;
const RAY = 10n ** 27n;

/** Asset units for `shares`, from `useLeverageYieldPreviewRedeem({ params: { vault, shares: WAD } })`. */
export const shareValue = (shares: bigint, pricePerShare: bigint): bigint => (shares * pricePerShare) / WAD;

/** Exposure the depositor holds, in WAD: 1 + the borrowed multiple. */
export const exposureWad = (leverageMultiplierWad: bigint): bigint => WAD + leverageMultiplierWad;

/** Simple-interest projection over `days` at today's APR (asset units). Can be negative. */
export const projectedInterest = (assets: bigint, aprRay: bigint, days: bigint): bigint =>
  (assets * aprRay * days) / (365n * RAY);

export const toUsd = (amount: bigint, decimals: number, priceUsd: number): number =>
  Number(formatUnits(amount, decimals)) * priceUsd;
```

Label projections as estimates at today's variable APR, and keep the sign: a negative APR projects a loss.

## Units

| Value | Unit | Display as |
|---|---|---|
| `*AprRay` (`effectiveNetAprRay`, `netAprRay`, …) | RAY, `1e27` = 100% | `Number(v * 10_000n / RAY) / 100` → percent |
| `targetLtvBps`, position `ltv` | basis points, `10_000` = 100% | `/ 100` → percent |
| `leverageMultiplierWad` | WAD, borrowed multiple | `1 +` it, as `×` |
| `healthFactor` | WAD; below `1e18` is liquidatable; `maxUint256` means no debt | `v === maxUint256 ? 'no debt' : formatUnits(v, 18)` |
| Shares (`lsoda*`) | 18 decimals | `formatUnits(v, 18)` |
| `getTotalAssets`, `previewRedeem`, position `collateral` / `debt` / `idleAsset` | the vault asset's units (18 decimals today) | `formatUnits(v, assetDecimals)`, then USD |
| `priceInUSD` | decimal string, USD per whole token | `Number(v)` |

## Acceptance

The flow is done when the user can:

- see every vault with its asset, APR (marked as variable, sign kept), TVL in the asset and USD, exposure, and health;
- see what they will receive, the minimum they accept, and the steps they will sign, before signing;
- sign without a zero or hand-picked minimum, and without an unrequested partner fee;
- follow each step to completion, with a link to each transaction on the right explorer;
- see their shares per network, worth in the asset and in USD;
- withdraw from the network that deposited, with the amount capped at their shares;
- cancel in the wallet without an error, and read a clear message for every state in [States](#states).
