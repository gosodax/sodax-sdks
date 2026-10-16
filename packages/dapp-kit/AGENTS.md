# packages/dapp-kit

High-level React hooks for SODAX dApps. This package wraps `@sodax/sdk` services with React Query and is designed to be used beside `@sodax/wallet-sdk-react`, without directly depending on it.

## Architecture

- `SodaxProvider` creates and provides the SDK instance through context.
- Hooks are organized by feature under `src/hooks/`.
- Read hooks use React Query `useQuery`.
- Mutation hooks use the package wrapper `useSafeMutation`, not React Query `useMutation` directly.
- SDK `Result<T>` values are translated into React Query's success/error model by `unwrapResult`.
- Wallet-layer objects are passed in by consumers through hook params or mutation vars. Do not import wallet-sdk-react into this package.

## Provider Rules

Recommended app stack:

```tsx
<SodaxProvider config={sodaxConfig}>
  <QueryClientProvider client={queryClient}>
    <SodaxWalletProvider config={walletConfig}>
      <App />
    </SodaxWalletProvider>
  </QueryClientProvider>
</SodaxProvider>
```

`SodaxProvider` tracks `config` by reference. If the object identity changes, the SDK instance is recreated. Prefer module constants or memoized config objects in examples.

Use `createSodaxQueryClient` when an app wants the shared mutation-error observability hook. Preserve `meta.silent` behavior when changing it.

## Hook Shapes

Read hooks accept a single object with `params` and `queryOptions`.

```ts
export type UseFooParams = ReadHookParams<FooData, { id: string | null }>;

export function useFoo({ params, queryOptions }: UseFooParams = {}) {
  return useQuery({
    queryKey: ['feature', 'foo', params?.id],
    queryFn: async () => {
      if (!params?.id) throw new Error('id is required');
      return readFoo(params.id);
    },
    enabled: params?.id != null,
    ...queryOptions,
  });
}
```

Mutation hooks accept a single optional object with `mutationOptions`. All domain inputs flow through `mutate(vars)`, not the hook argument.

```ts
export function useFooMutation({
  mutationOptions,
}: MutationHookParams<FooResult, FooVars> = {}): SafeUseMutationResult<FooResult, Error, FooVars> {
  return useSafeMutation({
    mutationKey: ['feature', 'foo'],
    ...mutationOptions,
    mutationFn: async vars => unwrapResult(await sodax.feature.foo(vars)),
  });
}
```

Required mutation rules:

- Use `useSafeMutation`.
- Return `SafeUseMutationResult<TData, Error, TVars>`.
- Type options with `MutationHookParams<TData, TVars>`.
- Set the default `mutationKey` before spreading consumer options.
- Define `mutationFn` after the spread so consumers cannot override it.
- Use `unwrapResult` for SDK methods that return `Result<T>`.
- Compose hook-owned callbacks with consumer callbacks; do not replace them.
- Derive invalidation keys from `vars`, not hook-time closures.

## Query And Mutation Keys

Keys follow `[feature, action, ...identifiers]`.

- First segment is the feature directory name.
- Segments use camelCase.
- Order identifiers stably: chain, token/asset, user, amount.
- Stringify bigint values before putting them in keys.
- Invalidate the narrowest key that can have changed. Broad invalidation should be reserved for cases where the changed variant is unknown.

Mutation key shape is enforced by `src/hooks/_mutationContract.test.ts`. Register new mutation hooks in that manifest.

## Result Handling

SDK methods return `Result<T>`. dapp-kit mutation hooks expose the unwrapped success value to React Query.

- `mutate(vars)` is fire-and-forget and updates React Query state.
- `mutateAsync(vars)` resolves to `TData` or rejects on SDK failure.
- `mutateAsyncSafe(vars)` never rejects and resolves to `Result<TData>`.

Prefer `mutateAsyncSafe` in imperative dApp flows where user rejection is an expected branch.

## Adding A Hook

1. Place the hook in the matching `src/hooks/<feature>/` directory.
2. Use `useSodaxContext()` for SDK access.
3. Follow the read or mutation shape above.
4. Add precise query keys and invalidations.
5. Export from the feature barrel and `src/hooks/index.ts`.
6. For mutations, add the hook to `_mutationContract.test.ts`.
7. For a wire-client hook (`hooks/swapsApi/`, `hooks/bridgeApi/`, `hooks/leverageYieldApi/`) that accepts `apiConfig`, add a row to `src/hooks/_apiKeyWire.test.ts` so the key-on-wire coverage stays complete. A feature hook that takes one — `useLeverageYieldDetailedStatus` does — belongs there only if it calls the wire client itself; otherwise the key travels through a service and is covered in `packages/sdk`.
8. Update `packages/skills` docs when public hook signatures, keys, polling intervals, or examples change.

## AI Docs Coupling

Consumer-facing dapp-kit skill material lives in:

```text
packages/skills/skills/sodax-dapp-kit/
├── integration/
└── migration-v1-to-v2/
```

Source is the source of truth. When changing a hook signature, query key, mutation key, return shape, or polling interval, search that skill tree for the affected hook names and update the matching knowledge files.

Useful validation:

```bash
pnpm --filter @sodax/skills check:ai
```

`README.md` is generated into the docs.sodax.com Mintlify site, so its hook-reference links must be absolute `https://github.com/icon-project/sodax-sdks/blob/main/packages/dapp-kit/src/…` URLs — a relative `src/…` link 404s on the published page. Gate: `pnpm check:doc-links`.

## Build And Tests

```bash
cd packages/dapp-kit
pnpm test
pnpm build
pnpm checkTs
```

The package builds ESM with declarations. React, React DOM, and React Query are peer/external dependencies.

`checkTs` typechecks test files too: `tsconfig.json` deliberately does not exclude them, and the
shared `scripts/check-tests-typechecked.mjs` (repo root, the tail of `checkTs`) fails loudly if a
future exclude hides them again. It also requires a one-line why-comment on every `as unknown as`
in a test file, with pre-existing undocumented casts grandfathered in this package's
`scripts/test-cast-comment-baseline.json`, which may only shrink.
