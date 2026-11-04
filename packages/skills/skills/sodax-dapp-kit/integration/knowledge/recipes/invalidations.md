# Recipe: Invalidations — hook-owned, composable

Every dapp-kit mutation hook owns its own query invalidations. After a successful mutation, the hook's `onSuccess` fires invalidation calls against the relevant query keys; **then** your consumer-provided `onSuccess` runs.

## Default — invalidations just work

```tsx
import { useSwap } from '@sodax/dapp-kit';
import type { CreateIntentParams, IEvmWalletProvider } from '@sodax/sdk';

function SwapButton({ params, walletProvider }: { params: CreateIntentParams; walletProvider: IEvmWalletProvider }) {
  const { mutateAsync: swap } = useSwap();

  const handleClick = async () => {
    // After this resolves successfully, dapp-kit invalidates `xBalances`
    // for the source and destination chains automatically.
    await swap({ params, walletProvider });
  };

  return <button onClick={handleClick}>Swap</button>;
}
```

You don't need to call `queryClient.invalidateQueries` yourself. Each mutation hook knows what queries it can invalidate (e.g. `useSwap` invalidates `xBalances` for `srcChainKey` and `dstChainKey` from the variables).

## Composing your own `onSuccess`

Pass `mutationOptions.onSuccess` to run logic AFTER dapp-kit's invalidations:

```tsx
import { useSwap } from '@sodax/dapp-kit';

const { mutateAsync: swap } = useSwap({
  mutationOptions: {
    onSuccess: (data, vars) => {
      // Runs AFTER dapp-kit's xBalances invalidations.
      // `data` is the unwrapped success value (SwapResponse).
      trackSwap(data);
      console.log('swap_complete', { from: vars.params.srcChainKey });
    },
  },
});
console.log(swap);
```

The order is fixed:

1. `mutationFn` resolves successfully (SDK returned `{ ok: true }`).
2. dapp-kit's hook-internal `onSuccess` runs the invalidations.
3. Your `mutationOptions.onSuccess` runs.
4. Per-call `mutate(vars, { onSuccess })` runs (if provided).

Failed mutations never trigger any of steps 2–4 — invalidations are correctness logic, not "always run."

## What gets invalidated, by feature

Each feature mutation hook invalidates the related read keys. Common patterns:

| Mutation | Invalidates |
|---|---|
| `useSwap` | `invalidateBalances(queryClient, srcChainKey, dstChainKey)` |
| `useBridge` | Same as `useSwap` (balances on both chains). |
| `useSupply`, `useWithdraw`, `useBorrow`, `useRepay` | `['mm', 'userReservesData']`, `invalidateBalances(queryClient, srcChainKey)`, plus reserves data on the affected token. |
| `useStake`, `useUnstake`, `useClaim`, `useCancelUnstake`, `useInstantUnstake` | `['staking', 'info']`, `['staking', 'unstakingInfo']`, `invalidateBalances(queryClient, srcChainKey)`. |
| `useDexDeposit`, `useDexWithdraw` | `['dex', 'poolBalances']`, `invalidateBalances(queryClient, srcChainKey)`. |
| `useSupplyLiquidity`, `useDecreaseLiquidity`, `useClaimRewards` | `['dex', 'positionInfo', tokenId]`, `['dex', 'poolBalances']`. |
| `useMigrateIcxToSoda`, etc. | `invalidateBalances(queryClient, …)` for source + destination chains. |
| Approve hooks (`useSwapApprove`, etc.) | The corresponding allowance read (`['swap', 'allowance']`, etc.). |

`invalidateBalances(queryClient, ...chainKeys)` is exported from `@sodax/dapp-kit`; it invalidates BOTH `['shared','balances', chainKey]` (`useBalances`) and `['shared','xBalances', chainKey]` (`useXBalances`), skipping `undefined` and collapsing duplicates. React Query matches keys element-wise, so one never matches the other — hand-rolling a single key leaves the other hook stale. Use the helper in your own mutations too.

The exact keys are derived from `vars` at success time — so a successful supply on Base only invalidates Base-side reserves, not Arbitrum's.

## Adding cross-feature invalidations

If you operate across multiple features (e.g. you have a custom hook that does `swap → migrate`), invalidate the cross-feature keys yourself in the consumer `onSuccess`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { useSwap } from '@sodax/dapp-kit';

const qc = useQueryClient();
const { mutateAsync: swap } = useSwap({
  mutationOptions: {
    onSuccess: async (data, vars) => {
      // dapp-kit invalidates xBalances. We additionally want to refresh a
      // custom analytics view that tracks completed swap volume.
      await qc.invalidateQueries({ queryKey: ['my-app', 'swap-volume'] });
    },
  },
});
```

## Per-call invalidation

For one-off invalidations (only on this specific click), pass `onSuccess` to `mutate`:

```tsx
// @ai-snippets-skip
await swap.mutateAsync(
  { params, walletProvider },
  { onSuccess: () => navigate(`/swap/${data.intent.intentHash}`) }
);
```

The order is unchanged: hook invalidations → consumer `onSuccess` → per-call `onSuccess`.

## v1 → v2

In v1 dapp-kit, consumers managed invalidations themselves — most apps had a `lib/invalidate*Queries.ts` utility that fired `queryClient.invalidateQueries(...)` after each mutation. Those utilities are no longer needed in v2; delete them.

If you're migrating v1 code, see [`breaking-changes/hook-signatures.md`](../../../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md) for the full delta.

## Cross-references

- [`mutation-error-handling.md`](mutation-error-handling.md) — picking call shapes.
- [`../architecture.md`](../architecture.md) — `_mutationContract.test.ts` enforces the canonical `onSuccess` composition pattern.
