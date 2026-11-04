# Recipes — `@sodax/dapp-kit`

Copy-paste patterns for adding SODAX features to a React app. Each recipe is self-contained and shows the canonical v2 hook shape (single-object params, `mutateAsyncSafe` for imperative flows, `Result<T>` handling).

## Reading order

1. **[`setup.md`](setup.md)** — Install packages, wire `SodaxProvider` + `QueryClientProvider`, optional `createSodaxQueryClient` for global mutation observability.
2. **[`wallet-connectivity.md`](wallet-connectivity.md)** — Connect wallets via `@sodax/wallet-sdk-react`, get a typed `walletProvider` per chain, fetch token balances.
3. Pick a feature recipe — each one is independent of the others.

## Index

### Foundation

| Recipe | Purpose |
|---|---|
| [`setup.md`](setup.md) | Install packages, wire providers, optional `createSodaxQueryClient` |
| [`wallet-connectivity.md`](wallet-connectivity.md) | Wallet connection, `useWalletProvider`, balance hooks |

### Cross-cutting patterns

| Recipe | Purpose |
|---|---|
| [`mutation-error-handling.md`](mutation-error-handling.md) | Pick between `mutate` / `mutateAsync` / `mutateAsyncSafe` |
| [`observability.md`](observability.md) | Global mutation logging via `createSodaxQueryClient`, per-mutation `meta.silent` |
| [`invalidations.md`](invalidations.md) | Hook-owned invalidations and how to compose your own `onSuccess` |

### Per-feature

| Recipe | Hooks covered |
|---|---|
| [`swap.md`](swap.md) | `useQuote`, `useSwap`, `useSwapAllowance`, `useSwapApprove`, limit orders |
| [`bridge.md`](bridge.md) | `useBridge`, allowance/approval, bridgeable amounts/tokens |
| [`money-market.md`](money-market.md) | `useSupply`, `useBorrow`, `useWithdraw`, `useRepay`, reserves data |
| [`staking.md`](staking.md) | `useStake`, `useUnstake`, `useClaim`, staking info, ratios |
| [`migration.md`](migration.md) | `useMigrateIcxToSoda`, `useRevertMigrateSodaToIcx`, `useMigratebnUSD`, `useMigrateBaln` |
| [`dex.md`](dex.md) | `useDexDeposit`, `useSupplyLiquidity`, positions, pools |
| [`leverage-yield.md`](leverage-yield.md) | `useLeverageYieldDeposit`, `useLeverageYieldWithdraw`, `useLeverageYieldVaultSwap`, APR/position/TVL/share-balance reads |
| [`leverage-yield-product-anatomy.md`](leverage-yield-product-anatomy.md) | A user-facing vault screen: journey, states, display metadata, USD prices, derived values, units, planned steps + explorer links, acceptance |
| [`bitcoin.md`](bitcoin.md) | `useRadfiSession`, `useFundTradingWallet`, `useRadfiWithdraw`, UTXO management |
| [`backend-queries.md`](backend-queries.md) | Intent tracking, orderbook, money market position queries (read-only, no wallet) |

## Hook conventions (mandatory)

These rules are enforced across every dapp-kit hook by a contract test in the `@sodax/dapp-kit` source (`src/hooks/_mutationContract.test.ts`) and apply to everything you write against this package.

### Single-object params

```tsx
import { useSwap, useSwapAllowance } from '@sodax/dapp-kit';
import { ChainKeys } from '@sodax/sdk';

// Query hooks — { params, queryOptions }
// Note: many query hooks wrap the SDK request under `params.payload`; some nest sibling
// fields like `walletProvider` or `srcChainKey` under `params` alongside `payload`.
// `useSwapAllowance` is one such hook — see features/swap.md for the canonical shape.
const { data: isApproved } = useSwapAllowance({
  params: { payload: intentParams, srcChainKey: ChainKeys.BSC_MAINNET, walletProvider },
});

// Mutation hooks — hook takes only mutationOptions; domain inputs flow through mutate(vars)
const { mutateAsync: swap } = useSwap();
async function runSwap() {
  if (!walletProvider) return;
  await swap({ params: intentParams, walletProvider });
}
```

No positional args. No `spokeProvider` at the hook level (that was v1; deleted in v2). All domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)` for mutations and through `params` for queries.

### `mutateAsyncSafe`

Every mutation hook returns three call shapes. `mutateAsyncSafe` is the recommended default for sequenced flows — it returns `Promise<Result<TData>>` and never rejects:

```tsx
import { useSwap } from '@sodax/dapp-kit';

const { mutateAsyncSafe: swap } = useSwap();
async function runSwap() {
  if (!walletProvider) return;
  const result = await swap({ params: intentParams, walletProvider });
  if (!result.ok) { toast.error(result.error instanceof Error ? result.error.message : 'failed'); return; }
  const { intent } = result.value;
  console.log(intent);
}
```

Full comparison in [`mutation-error-handling.md`](mutation-error-handling.md).

### `queryOptions`

All query hooks accept optional `queryOptions` to override React Query defaults. The hook owns `queryKey`, `queryFn`, and `enabled` — those are not consumer-overridable.

```tsx
import { useQuote } from '@sodax/dapp-kit';

// `useQuote` wraps the SDK request under `params.payload` — don't pass the SDK request
// directly under `params`. `payload` here is a `SolverIntentQuoteRequest`.
const { data } = useQuote({
  params: { payload },
  queryOptions: { staleTime: 5000, refetchInterval: 10000 },
});
```

### `Result<T>` in query hooks

Some query hooks return `Result<T>` as their `data` (the underlying SDK method can fail). Always check `.ok` before accessing `.value`:

```tsx
import { useQuote } from '@sodax/dapp-kit';

// useQuote nests the SDK request under params.payload. `payload` here is a `SolverIntentQuoteRequest`.
const { data: quoteResult } = useQuote({ params: { payload } });
if (quoteResult?.ok) {
  const quote = quoteResult.value;
  console.log(quote);
} else {
  console.error(quoteResult?.error);
}
```

### `bigint` for amounts

Token amounts are `bigint` scaled by decimals. Use `viem`'s `parseUnits` / `formatUnits`:

```tsx
import { parseUnits, formatUnits } from 'viem';
const amount = parseUnits('1.5', 18);   // 1500000000000000000n
const display = formatUnits(amount, 18); // '1.5'
```

## Backend / non-React consumers

If you're building a backend (API server, bot, script), you don't need `@sodax/dapp-kit` at all — use `@sodax/sdk` directly. The SDK has its own knowledge tree shipped via `@sodax/skills` — load the `sodax-sdk` (integration mode) skill.

## Migration pointer

If you're porting v1 dapp-kit code to v2, start at [`README.md`](../../../migration-v1-to-v2/knowledge/README.md). It covers: hook signatures (single-arg policy), `Result<T>` handling shift, deleted `useSpokeProvider`, queryKey conventions, and SDK leakage.
