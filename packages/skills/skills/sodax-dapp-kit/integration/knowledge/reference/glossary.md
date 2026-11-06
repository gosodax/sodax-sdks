# Glossary — `@sodax/dapp-kit` v2

Type aliases, conventions, and domain terms specific to dapp-kit. SDK-side terms (Hub, Spoke, Intent, ChainKey, SodaxError, etc.) are documented in `sodax-sdk`: `integration/knowledge/reference/glossary.md`.

## Hook shape types

### `ReadHookParams<TData, TParams = void>`

Canonical shape for query hook arguments. Single object with `params` and `queryOptions` keys.

```ts
// @ai-snippets-skip
type ReadHookParams<TData, TParams = void> = TParams extends void
  ? { queryOptions?: ReadQueryOptions<TData> }
  : { params?: TParams; queryOptions?: ReadQueryOptions<TData> };
```

If a hook has no domain inputs (e.g. `useStakingConfig`), it uses `ReadHookParams<TData>` (no `TParams`) and accepts `({} = {})` for ergonomic no-arg calls.

### `ReadQueryOptions<TData>`

The options slot for query hooks, omitting hook-owned fields.

```ts
// @ai-snippets-skip
type ReadQueryOptions<TData> = Omit<UseQueryOptions<TData, Error>, 'queryKey' | 'queryFn' | 'enabled'>;
```

Hook owns `queryKey`, `queryFn`, and `enabled` — never consumer-overridable. `enabled` is derived from required-input presence.

### `MutationHookParams<TData, TVars>`

Canonical shape for mutation hook arguments. Single object with one key: `mutationOptions`.

```ts
// @ai-snippets-skip
type MutationHookParams<TData, TVars> = {
  mutationOptions?: MutationHookOptions<TData, TVars>;
};
```

Domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)` via `TVars`.

### `MutationHookOptions<TData, TVars>`

The options slot for mutation hooks, omitting hook-owned fields.

```ts
// @ai-snippets-skip
type MutationHookOptions<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>;
```

Hook owns `mutationFn`. Consumer can override `mutationKey`, `onSuccess`, `onError`, `retry`, `meta`, etc.

### `SafeUseMutationResult<TData, TError, TVars>`

The return type of every dapp-kit mutation hook. Extends React Query's `UseMutationResult` with `mutateAsyncSafe`.

```ts
// @ai-snippets-skip
type SafeUseMutationResult<TData, TError, TVars> = UseMutationResult<TData, TError, TVars> & {
  mutateAsyncSafe: (vars: TVars) => Promise<Result<TData>>;
};
```

`mutateAsyncSafe` never rejects — it packs the rejection into `Result<T>`. Use it for sequenced flows.

### `Result<T>`

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: Error | unknown };
```

Re-exported from `@sodax/sdk`. Used as:
- The SDK service method return type (which `unwrapResult` translates to throws).
- The return type of `mutateAsyncSafe`.
- The `data` of some query hooks (when the underlying SDK method returns Result and we choose to surface it directly to the consumer rather than unwrapping in the hook).

### `TxHashPair`

```ts
type TxHashPair = {
  srcChainTxHash: string;
  dstChainTxHash: string;
};
```

Re-exported from `@sodax/sdk`. Cross-chain mutation return: spoke chain tx + relayed hub tx. Returned by `useBridge`, all four MM mutations, all five staking mutations, `useDexDeposit`/`useDexWithdraw`, all four migration mutations — `useBorrow`, `useWithdraw` and `useDexWithdraw` as `OutboundSettlement<K>`, which from Tron is `{ trackingId, dstChainTxHash }`.

**Always destructure by name, never as `[a, b]`.**

## Hook lifecycle terms

### `mutationFn`

The function React Query invokes for a mutation. In dapp-kit, every `mutationFn` calls `unwrapResult(await sodax.<feature>.<method>(vars))`. Throws on SDK `!ok`. Hook-owned, never consumer-overridable.

### `unwrapResult`

```ts
// @ai-snippets-skip
function unwrapResult<T>(result: Result<T>): T;
```

`{ ok: true; value }` → `value`. `{ ok: false; error }` → throws `error`. The bridge from SDK Result contract to React Query throw contract.

### `toResult`

```ts
// @ai-snippets-skip
function toResult<T>(promise: Promise<T>): Promise<Result<T>>;
```

Inverse of `unwrapResult` for the rejection direction. Used internally by `useSafeMutation` to build `mutateAsyncSafe`.

### `useSafeMutation`

Drop-in for React Query's `useMutation`. Returns `SafeUseMutationResult` (extends `UseMutationResult` with `mutateAsyncSafe`). Every dapp-kit mutation hook calls this — never call React Query's `useMutation` directly.

### `mutateAsyncSafe`

The third call shape on every mutation hook. Returns `Promise<Result<TData>>`. Never rejects. Recommended for imperative sequenced flows.

## Provider terms

### `SodaxProvider`

App-level React component. Provides:
- A `Sodax` SDK instance (via `useSodaxContext()`)
- RPC config for all chains
- Hub provider access (via `useHubProvider()`)

Optional config: `<SodaxProvider config={SodaxOptions}>` (`SodaxOptions = DeepPartial<SodaxDefaultConfig> & SodaxOptionalConfig` — the data override plus client-side options `logger` + global `fee`). Without config, SDK uses packaged defaults.

Config is tracked by **reference** - see [`recipes/setup.md § Config reactivity`](../recipes/setup.md#config-reactivity) for module-const vs `useMemo` patterns.

### `createSodaxQueryClient`

Factory for a `QueryClient` with `MutationCache.onError` pre-wired for global mutation observability. Optional — if you construct your own `QueryClient`, dapp-kit hooks still work; you just don't get the global observability seam.

### `useSodaxContext`

The escape hatch into the SDK from any component under `SodaxProvider`. Returns `{ sodax: Sodax }`. Most hooks use this internally; consumers rarely need it directly.

## Convention terms

### "Single-object params"

Every hook accepts exactly one object argument. No positional args. For mutations: `{ mutationOptions }`. For queries: `{ params, queryOptions }`. Mechanically enforced.

### "Zero-domain-param policy"

The mutation-hook rule that no domain inputs (`params`, `walletProvider`, etc.) live at the hook-init level — they all flow through `mutate(vars)` via `TVars`. This lets a single hook serve many call shapes without remounting.

### "Hook-owned invalidations"

Mutation hooks invalidate the relevant query keys in their own `onSuccess`. Consumer-provided `onSuccess` runs after. Replaces v1's manual `invalidateMmQueries` utilities.

### "Composed `onSuccess`"

The pattern by which a hook's internal `onSuccess` calls invalidations first, then `await mutationOptions?.onSuccess?.(...)` so the consumer's callback still fires.

### "queryKey rule"

Every queryKey/mutationKey starts with the feature directory name (`'swap'`, `'mm'`, `'bridge'`, `'staking'`, `'dex'`, `'bitcoin'`, `'partner'`, `'recovery'`, `'backend'`, `'shared'`, `'migrate'`). camelCase segments. Bigints stringified. See [`querykey-conventions.md`](querykey-conventions.md).

### "Default `mutationKey` before the spread"

<!-- ai-keys-allow -->
The order inside `useSafeMutation` calls: default `mutationKey: ['feature', 'action']` BEFORE `...mutationOptions`, then `mutationFn` AFTER. This way the consumer can override the default key via `mutationOptions.mutationKey`, but `mutationFn` (hook-owned) always wins.

## v1 → v2 remapping

When porting v1 code, these shifts are pervasive:

| v1 | v2 |
|---|---|
| Positional hook args | Single-object params |
| Hook-level `spokeProvider` | `walletProvider` flows through `mutate(vars)` |
| `Result<T>` returned via React Query success | Throws in `mutationFn`; use `mutateAsyncSafe` for `Result<T>` flow |
| Approve hook returns `{ approve, isLoading, error }` | Returns `SafeUseMutationResult` with `mutateAsync` / `isPending` |
| Consumer-managed invalidations (`invalidateMmQueries`) | Hook-owned in composed `onSuccess` |
| Ad-hoc queryKey shapes | Feature-prefixed, camelCase, stringified bigints |

## Cross-references

- [`../architecture.md`](../architecture.md) — full design rationale for these types and conventions.
- [`querykey-conventions.md`](querykey-conventions.md) — queryKey/mutationKey rules.
- [`public-api.md`](public-api.md) — what's exported.
- `sodax-sdk`: `integration/knowledge/reference/glossary.md` — SDK-side terms (Hub, Spoke, Intent, ChainKey, SodaxError).
