# Architecture — `@sodax/dapp-kit` v2

Every v2 design concept the hooks rest on, in one TOC-navigable file. Read it once before writing call sites — most of the v1→v2 breakage and most of the new-code traps come from misunderstanding one of these.

## Five pieces hold it together

1. **Two canonical hook shapes.**
   - Read hooks accept `{ params, queryOptions }` typed via `ReadHookParams<TData, TParams>`.
   - Mutation hooks accept `{ mutationOptions }` typed via `MutationHookParams<TData, TVars>` and return `SafeUseMutationResult<TData, Error, TVars>`.
   - All domain inputs (params, walletProvider, apiConfig) flow through `mutate(vars)`, never the hook arg.
2. **`useSafeMutation` foundation.** Every mutation hook calls `useSafeMutation(...)` (drop-in for React Query's `useMutation`), which augments the result with `mutateAsyncSafe(vars): Promise<Result<TData>>` — never rejects.
3. **`unwrapResult` translation.** SDK service methods return `Result<T>`. `unwrapResult` converts to thrown errors inside `mutationFn` so React Query's native error model engages (`isError`, `error`, `onError`, `retry`, devtools) for SDK failures.
4. **`createSodaxQueryClient`** (optional). Factory that returns a `QueryClient` with a `MutationCache.onError` hook giving consumers a single observability seam, plus a `meta.silent` per-mutation opt-out.
5. **Mechanical enforcement.** `_mutationContract.test.ts` asserts the canonical shape on every mutation hook (`useSafeMutation` not `useMutation`, default `mutationKey` before the spread, `mutationFn` after, `unwrapResult` translation, feature-prefix queryKey rule).

## Provider stack

`SodaxProvider` wraps the app and provides:
- The `Sodax` SDK instance
- RPC configuration for all chains
- Hub provider access

```tsx
// @ai-snippets-skip
<SodaxProvider config={sodaxConfig}>            {/* SDK instance + RPC config */}
  <QueryClientProvider client={queryClient}>    {/* prefer createSodaxQueryClient() */}
    <SodaxWalletProvider config={walletConfig}> {/* from @sodax/wallet-sdk-react (optional) */}
      <YourApp />
    </SodaxWalletProvider>
  </QueryClientProvider>
</SodaxProvider>
```

`SodaxProvider` does **not** depend on `@sodax/wallet-sdk-react` — wallet state is wired side-by-side. Backend / non-React consumers (Node scripts, bots) bypass dapp-kit entirely and use `@sodax/sdk` directly with their own wallet implementation.

**Config reactivity.** `config` is tracked by reference - see [`recipes/setup.md § Config reactivity`](recipes/setup.md#config-reactivity) for the module-const vs `useMemo` patterns.

### `createSodaxQueryClient`

Returns a `QueryClient` pre-wired with a `MutationCache.onError` hook for global mutation observability. Default behavior: logs every mutation failure to console as `[sodax] Mutation error: <error>`.

```tsx
import { createSodaxQueryClient } from '@sodax/dapp-kit';

// Default
const queryClientDefault = createSodaxQueryClient();

// Wire to your own logger
const queryClientWithSentry = createSodaxQueryClient({
  onMutationError: (e) => Sentry.captureException(e),
});

// Disable entirely
const queryClientSilent = createSodaxQueryClient({ onMutationError: () => {} });
```

Per-mutation opt-out via `meta.silent`:

```tsx
// @ai-snippets-skip
const swap = useSwap({
  mutationOptions: {
    meta: { silent: true },
    onError: (e) => toast.error(e.message),
  },
});
```

This is **observability**, not prevention. It does NOT detect "unhandled" rejections — it fires for **every** mutation failure regardless of whether the consumer caught the rejection or registered a per-hook `onError`. To prevent unhandled rejections, use `mutateAsyncSafe`.

## Read hook shape (mandatory)

All read-only hooks accept a single object with exactly two top-level keys: `params` (SDK-feature-domain inputs — the *what* being fetched) and `queryOptions` (React Query knobs — the *how*).

Rules:

- **Single params object with two top-level keys.** `{ params, queryOptions }`. Nothing else at the top level.
- **Use the shared types.** Params type MUST be `ReadHookParams<TData, TParams>`; the `queryOptions` slot is typed `ReadQueryOptions<TData>` (which is `Omit<UseQueryOptions<TData, Error>, 'queryKey' | 'queryFn' | 'enabled'>`). Hook owns `queryKey`, `queryFn`, `enabled` — never consumer-overridable.
- **Hierarchical query keys.** `[feature, action, ...inputs]`. Stringify bigints with `.toString()`.
- **No-input hooks.** Type as `ReadHookParams<TData>` (no `TParams` generic) and accept the whole arg as optional, defaulting to `{}` for ergonomic no-arg calls (`useStakingConfig({})`).

Canonical example:

```ts
// @ai-snippets-skip — definition-shape illustration; function body elided with `// ...`
import type { PoolData, PoolKey } from '@sodax/sdk';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReadHookParams } from '@sodax/dapp-kit';

export type UsePoolDataParams = ReadHookParams<PoolData, { poolKey: PoolKey | null }>;

export function usePoolData({ params, queryOptions }: UsePoolDataParams = {}): UseQueryResult<PoolData, Error> {
  // ... uses sodax.dex.clService.getPoolData internally
}
```

Call site:

```ts
// @ai-snippets-skip
const { data } = usePoolData({ params: { poolKey } });
```

## Mutation hook shape (mandatory)

All mutation hooks follow the **zero-domain-param** policy: the hook function takes a single optional argument with exactly one top-level key — `mutationOptions` — and ALL domain inputs (`params`, `walletProvider`, per-call config, etc.) flow through `mutate(vars)` via the typed `TVars` payload.

Three shared utilities underpin every mutation hook:

- **`useSafeMutation(options)`** — drop-in for React Query's `useMutation`. Returns `SafeUseMutationResult<TData, Error, TVars>` (extends `UseMutationResult` with `mutateAsyncSafe`).
- **`unwrapResult(result)`** — `Result<T>` → throw `error` on `!ok`, return `value` on `ok`. Use inside `mutationFn`.
- **`toResult(promise)`** — pure helper that catches `Promise<T>` rejection and packs into `Result<T>`. Used internally by `useSafeMutation`.

Rules:

- **Use `useSafeMutation`, not `useMutation`.** Every dapp-kit mutation hook MUST call `useSafeMutation`. The wrapper augments the result with `mutateAsyncSafe`, which consumers depend on.
- **One optional top-level arg.** `useFoo({ mutationOptions } = {}): SafeUseMutationResult<TData, Error, TVars>`.
- **Use the shared types.** `MutationHookParams<TData, TVars>`; return `SafeUseMutationResult<TData, Error, TVars>`; `mutationOptions` typed `MutationHookOptions<TData, TVars>` (which is `Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>`).
- **Hook owns `mutationFn`.** Never consumer-overridable.
- **`mutationFn` throws on SDK `!ok`.** Use `unwrapResult` from `@sodax/dapp-kit`. SDK returns `Result<T>`; the hook unwraps to `T` so React Query's native error model engages. `TData` is the unwrapped success type, NOT `Result<T>`.
- **Default `mutationKey` BEFORE the spread**, then spread `...mutationOptions`, then `mutationFn` last. Order matters: default key is overridable by consumer (spread wins), but `mutationFn` is hook-owned.
- **Compose `onSuccess` (and any other callbacks the hook itself defines).** Invalidations are correctness logic owned by the hook. Inside the hook's `onSuccess`, run invalidations first, then `await mutationOptions?.onSuccess?.(...)` so consumer hooks still fire.
- **Derive invalidation keys from `vars`, not closures.** `(data, vars, ctx) => ...` and read `vars.params.srcChainKey`.
- **All domain inputs go in `TVars`.** No `params`, `walletProvider`, `apiConfig` at the hook level. Pushing inputs into `mutate(vars)` lets a single hook serve many call shapes without remounting.

Canonical example:

```ts
import type { SwapActionParams, SwapResponse, SpokeChainKey } from '@sodax/sdk';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSodaxContext,
  useSafeMutation,
  unwrapResult,
  invalidateBalances,
  type MutationHookParams,
  type SafeUseMutationResult,
} from '@sodax/dapp-kit';

export type UseSwapVars<K extends SpokeChainKey = SpokeChainKey> = Omit<SwapActionParams<K, false>, 'raw'>;

export function useSwap<K extends SpokeChainKey = SpokeChainKey>({
  mutationOptions,
}: MutationHookParams<SwapResponse, UseSwapVars<K>> = {}): SafeUseMutationResult<SwapResponse, Error, UseSwapVars<K>> {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();

  return useSafeMutation<SwapResponse, Error, UseSwapVars<K>>({
    mutationKey: ['swap'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.swaps.swap({ ...vars, raw: false })),
    onSuccess: async (data, vars, ctx) => {
      // Covers both balance query families; they never prefix-match each other.
      invalidateBalances(queryClient, vars.params.srcChainKey, vars.params.dstChainKey);
      await mutationOptions?.onSuccess?.(data, vars, ctx);
    },
  });
}
```

## Choosing `mutate` / `mutateAsync` / `mutateAsyncSafe`

| Method | Returns | Rejects? | When to use |
|---|---|---|---|
| `mutate(vars)` | `void` (fire-and-forget) | Never | Button-click handlers reading `isPending` / `isError` / `error` in render. Consumer-supplied `onError` fires; React Query owns state. |
| `mutateAsync(vars)` | `Promise<TData>` | **Yes** on `!ok` | Imperative chains where you want exception flow. **MUST be inside `try/catch`.** |
| `mutateAsyncSafe(vars)` | `Promise<Result<TData>>` | **Never** | Imperative chains with explicit branching, no exception flow. Same React Query state under the hood. |

`mutateAsyncSafe` is the **recommended default** for sequenced flows — the user-reject case is the modal failure mode in dApps, not exceptional, and `Result<T>`-style branching reads cleaner than exception flow control.

```tsx
// @ai-snippets-skip
// fire-and-forget — read state in render
const m = useSwap();
<button onClick={() => m.mutate({ params, walletProvider })}>Swap</button>

// throws — for chains where you want exception flow
const { mutateAsync } = useSwap();
try { const r = await mutateAsync({ params, walletProvider }); /* … */ }
catch (e) { toast(e instanceof Error ? e.message : 'Swap failed'); }

// safe — for chains where you want explicit branching, no try/catch
const { mutateAsyncSafe } = useSwap();
const result = await mutateAsyncSafe({ params, walletProvider });
if (!result.ok) { toast(result.error.message); return; }
const { intent, intentDeliveryInfo } = result.value;
```

## SDK Result handling

Every public SDK service method returns `Result<T> = { ok: true; value: T } | { ok: false; error: Error | unknown }` and never throws. dapp-kit translates that contract into the React Query contract by **throwing `result.error` on `!ok` inside `mutationFn`.**

Why throw?
- React Query's `isError`, `error`, `onError`, `retry`, `throwOnError`, devtools all key off `mutationFn` throwing.
- Consumers had to remember to branch on `data.ok` inside every `onSuccess` to avoid running success logic on a failed swap. Forgetting was easy and silent.
- Hook-owned invalidations (in `onSuccess`) used to fire on SDK failure too, burning RPC traffic on every failed click.

After translating, the public hook signature is `SafeUseMutationResult<T, Error, TVars>`. `data` is the unwrapped success value (e.g. `SwapResponse`, `TxHashPair`); SDK failures arrive via `mutation.error` exactly like any other thrown error. Call sites pick from three call shapes (above).

The dual API means consumers never have to choose between React Query's error model and `Result<T>` ergonomics — both are exposed by the same hook.

## Approve hooks can prompt the wallet twice

Every `use*Approve` hook is unchanged and still resolves to a single transaction hash. But a few
ERC-20s of the 2017 TetherToken lineage — Ethereum USDT is the only one in the SODAX token list today
— reject an allowance change from one non-zero value to another. When the connected wallet already
holds a stale allowance on such a token, the SDK sends `approve(0)` first, waits for it to be mined,
and only then sends the real approval. The user therefore signs **twice**, and the hash the hook
resolves with is the **last** transaction's.

Nothing about the hook contract changes and there is no flag to set. What matters for UI:

- An `isPending` that renders a single "Approving…" now spans two wallet prompts. Say so in the copy,
  or the second prompt reads as a bug. On the unsigned paths, pass `onProgress` (below) and name the
  step instead of guessing.
- Anything estimating gas or counting transactions from "one approve = one transaction" is wrong on
  that branch.
- If the second signature is rejected after the reset landed, the allowance is now zero, so the next
  attempt is a single transaction — retrying is always safe.

On the unsigned (backend-API) paths, prefer **`useSwapsApiApproveAndBroadcast`** —
**`useBridgeApiApproveAndBroadcast`** for a bridge, **`useLeverageYieldApiApproveAndBroadcast`** for a
leverage-yield deposit: each asks its API for the transactions, then signs, broadcasts, and waits for
each, resolving with `{ approveTxHash, resetTxHash? }` only once the final approval has landed. A
transaction that mines but reverts rejects the mutation naming that step, so the approve is never
sent over a reset that did not take. Each also invalidates its own allowance query
(`['swapsApi','allowance']` / `['bridgeApi','allowance']` / `['leverageYieldApi','allowance']`),
because confirmation now happens inside the hook. Pick the one matching the action you are about to
take — each API builds its approval for its own hub spender, so an approval built by one does not
satisfy the other. Only a leverage-yield **deposit** needs one; a withdraw spends `lsoda*` from the
hub wallet and never approves.

All three accept an optional **`onProgress`** in their mutation vars. It reports each transaction as
`{ step, phase, index, total, hash?, error? }` — `step` is `'allowance-reset'` or `'approve'`, `phase`
walks `signing → broadcast → confirmed` (or `failed`), and `index`/`total` give "1 of 2" without the
caller tracking anything. Advisory: the listener is never awaited, one that throws is ignored rather
than aborting a broadcast, and the mutation's own result stays the source of truth. It lives in the
vars rather than the hook options so it is never a stale closure.

`useSwapsApiApprove` / `useBridgeApiApprove` / `useLeverageYieldApiApprove` still exist and return
the API's `{ tx, resetTx? }` verbatim — use them only when you need to own signing. If you do,
broadcast `resetTx` **first and wait for it to succeed**; the approve is not a valid state
transition until the reset has landed, so sending both together spends the user's gas on a certain
revert. Waiting is not enough on its own —
check the receipt's status, because a mined-and-reverted reset leaves the allowance exactly where it
was.

## queryKey / mutationKey conventions (mandatory)

Every `queryKey` and `mutationKey` follows the same structural rule. Enforced by `_mutationContract.test.ts` for mutation keys; reviewer-enforced for query keys.

**Rule 1 — first segment is the feature directory name.** No exceptions.

| Hook directory | First segment |
|---|---|
| `backend/` | `'backend'` |
| `bitcoin/` | `'bitcoin'` |
| `bridge/` | `'bridge'` |
| `dex/` | `'dex'` |
| `mm/` | `'mm'` |
| `partner/` | `'partner'` |
| `recovery/` | `'recovery'` |
| `shared/` | `'shared'` |
| `staking/` | `'staking'` |
| `swap/` | `'swap'` |
| `migrate/` | `'migrate'` |

**Rule 2 — camelCase for all segments.** No kebab-case (`'btc-balance'`), no ad-hoc casing. Identifiers are camelCase string literals (`'tradingWalletBalance'`, `'submitSwapTx'`).

**Rule 3 — shape is `[feature, action, ...identifiers]`** in stable order: chain → token/asset → user → amount. Example: `['mm', 'allowance', srcChainKey, token, action]`.

**Rule 4 — bigints stringify** via `.toString()` before going into a key (React Query's hash uses `JSON.stringify`, which throws on raw bigints).

**Rule 5 — invalidate the narrowest key that could change.** If the mutation knows the affected `tokenId` / user / chain, scope the invalidation to it.

Worked examples:

```ts
// @ai-snippets-skip
queryKey: ['mm', 'userReservesData', spokeChainKey, userAddress]
queryKey: ['mm', 'allowance', srcChainKey, token, action]
queryKey: ['shared', 'balances', chainKey, tokens, address]   // useBalances
queryKey: ['shared', 'xBalances', xChainId, tokens, address] // useXBalances
mutationKey: ['mm', 'supply']
queryClient.invalidateQueries({ queryKey: ['dex', 'positionInfo', tokenId, poolKey] });
```

## Hook organization

Hooks organized by feature domain in `src/hooks/`:

```
hooks/
├── shared/     # useSodaxContext, useSafeMutation, unwrapResult, useEstimateGas,
│               # useDeriveUserWalletAddress, useGetUserHubWalletAddress,
│               # useBalances, useXBalances, invalidateBalances,
│               # useStellarTrustlineCheck, useEstablishTrustline (+ deprecated useRequestTrustline)
├── provider/   # useHubProvider
├── swap/       # useSwapLifecycle, useSwapWithApproval, useSwapApprovalStrategy,
│               # useQuote, useSwap, useDetailedStatus, useStatus, useSwapAllowance, useSwapApprove,
│               # useCancelSwap, useCreateLimitOrder, useCancelLimitOrder
├── mm/         # useSupply, useWithdraw, useBorrow, useRepay, useMMAllowance, useMMApprove,
│               # reserves data hooks
├── bridge/     # useBridge, useBridgeAllowance, useBridgeApprove, bridgeable amounts/tokens
├── staking/    # useStake, useUnstake, useInstantUnstake, useClaim, staking info hooks
├── dex/        # usePools, useDexDeposit, useDexWithdraw, liquidity hooks
├── bitcoin/    # useRadfiSession, fund/withdraw, UTXO management
├── backend/    # Intent tracking, swap submission, orderbook, money market position queries
├── partner/    # Partner fee claim, auto-swap preferences, token approval
├── recovery/   # useHubAssetBalances, useWithdrawHubAsset
└── migrate/    # useMigrateIcxToSoda, useRevertMigrateSodaToIcx, useMigratebnUSD,
                # useMigrateBaln, useMigrationApprove, useMigrationAllowance
```

Every mutation hook returns `SafeUseMutationResult` and is registered in `_mutationContract.test.ts`'s manifest. Adding a non-conformant hook is a CI failure.

## Cross-references

- [`recipes/setup.md`](recipes/setup.md) — install + wire providers (worked example).
- [`recipes/wallet-connectivity.md`](recipes/wallet-connectivity.md) — `useWalletProvider`, balances.
- [`recipes/mutation-error-handling.md`](recipes/mutation-error-handling.md) — picking call shapes (worked examples).
- [`recipes/observability.md`](recipes/observability.md) — `createSodaxQueryClient` deep-dive.
- [`recipes/invalidations.md`](recipes/invalidations.md) — composing your own `onSuccess`.
- [`reference/querykey-conventions.md`](reference/querykey-conventions.md) — full key tables.
- [`features/`](features/) — per-feature reference (hook tables, types, gotchas).
- `sodax-sdk`: `integration/knowledge/architecture.md` — the underlying SDK architecture (`Result<T>`, `SodaxError<C>`, `WalletProviderSlot<K, Raw>`).
