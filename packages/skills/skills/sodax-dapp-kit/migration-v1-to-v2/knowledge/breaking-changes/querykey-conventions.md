# queryKey conventions — v1 → v2

This is a low-priority migration item — it only matters if your code grafts onto dapp-kit's cache invalidation (e.g. you fetch a related query and want it to be invalidated when dapp-kit's mutation fires).

If your app doesn't share queryKey shapes with dapp-kit, skip this file. The shape changes are a nicety, not a blocker — your existing keys still work for your own queries.

## What changed

v1 was ad-hoc; v2 is canonical.

| Aspect | v1 | v2 |
|---|---|---|
| First segment | Free-form (`'xBalances'`, `'btc-balance'`, `'api'`) | Feature directory name (`'shared'`, `'bitcoin'`, `'backend'`) |
| Casing | Mixed (kebab-case in places) | camelCase exclusively |
| Bigint values | Inconsistent | Always `.toString()` before going into a key |
| Default `mutationKey` | Many hooks had none | Every hook has a default; consumer can override |

## Why align?

Your custom queries can be invalidated by dapp-kit's mutations if they share the prefix:

```ts
// @ai-snippets-skip — illustrative; `queryFn` is shown as `...` placeholder
// Your custom query
const { data: customAnalytics } = useQuery({
  queryKey: ['shared', 'xBalances', xChainId, address, 'with-analytics'],
  queryFn: ...,
});

// Dapp-kit's `useSwap` invalidates `['shared', 'xBalances', srcChainKey]`,
// which is a PREFIX of your key — your query gets invalidated automatically.
```

If your key starts with something else (e.g. `['my-app', 'xBalances', ...]`), dapp-kit's invalidation won't touch it — you'd need to wire your own invalidation in `mutationOptions.onSuccess`.

## Migration patterns

### Sweep your custom queryKeys

If your app has custom queries that overlap with dapp-kit's domains, rename them to match v2 conventions:

<!-- ai-keys-allow — v1 keys shown for migration context; the `-` lines are v1 shapes, not real v2 source keys -->

```diff
  const { data } = useQuery({
-   queryKey: ['xBalances', address, ...],
+   queryKey: ['shared', 'xBalances', xChainId, [token], address],
    queryFn: ...,
  });

  const { data } = useQuery({
-   queryKey: ['btc-balance', address],
+   queryKey: ['bitcoin', 'balance', address],
    queryFn: ...,
  });
  <!-- ai-keys-allow -->

  const { data } = useQuery({
-   queryKey: ['api', 'mm', userAddress],
+   queryKey: ['backend', 'mm', userAddress],
    queryFn: ...,
  });
```

### If you previously overrode dapp-kit's queryKeys

v1 query hooks accepted `queryKey` overrides. v2 hooks own their queryKeys — the option is gone.

```diff
- const { data } = useUserReservesData({
-   spokeProvider,
-   address,
-   queryKey: ['my-app-mm-positions'],   // v1
- });
+ // v2 — drop the queryKey override; if you needed an alias, write your own useQuery.
+ const { data } = useUserReservesData({
+   params: { spokeChainKey, userAddress: address },
+ });
```

### If you had your own `mutationKey` defaults

v1 mutation hooks often had no default `mutationKey` — consumers set one in `mutationOptions`. v2 hooks set a sensible default (e.g. `['swap']`, `['mm', 'supply']`) — drop redundant overrides:

```diff
  const { mutateAsync: swap } = useSwap({
    mutationOptions: {
-     mutationKey: ['swap'],   // already the default in v2
      retry: false, // Resume the original source hash after a post-broadcast failure.
    },
  });
```

## Per-feature conventions

See [`reference/querykey-conventions.md`](../../../integration/knowledge/reference/querykey-conventions.md) for the full per-feature key tables. Use that as the reference when aligning your own keys.

## Done criteria

<!-- ai-keys-allow — the bare xBalances key below is shown as a v1-style anti-example -->
- [ ] No custom queryKeys overlapping with dapp-kit's domains using non-canonical first segments (e.g. `['xBalances', ...]` should become `['shared', 'xBalances', ...]`).
- [ ] No `queryKey` overrides in `useFooQuery({ ..., queryKey: [...] })` patterns (the option is gone).
- [ ] Optional: drop redundant default-`mutationKey` overrides in `mutationOptions`.

## Cross-references

- [`reference/querykey-conventions.md`](../../../integration/knowledge/reference/querykey-conventions.md) — full canonical conventions + per-feature key tables.
- [`hook-signatures.md`](hook-signatures.md) — broader hook-shape changes.
