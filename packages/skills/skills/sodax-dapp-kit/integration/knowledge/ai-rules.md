# AI rules — `@sodax/dapp-kit` integration

DO / DO NOT / workflow / stop conditions for AI agents writing v2 dapp-kit code. Read this **before** the per-feature docs — these rules prevent the most common load-bearing v2 traps.

## Workflow (do these in order)

1. **Survey the project before touching code.**

   ```bash
   pnpm tsc --noEmit                                                          # baseline typecheck
   grep -rE '@sodax/(dapp-kit|sdk|wallet-sdk-react)' --include='*.ts' --include='*.tsx' src/   # see what's already imported
   ```

2. **Wire providers first if not already wired.** [`recipes/setup.md`](recipes/setup.md). Provider stack: `SodaxProvider > QueryClientProvider > SodaxWalletProvider > YourApp`.
3. **Pick `mutate` / `mutateAsync` / `mutateAsyncSafe` deliberately.** See [`recipes/mutation-error-handling.md`](recipes/mutation-error-handling.md). Default to `mutateAsyncSafe` for sequenced flows.
4. **Branch on `result.ok` for `mutateAsyncSafe` results, or on `mutation.isError` / `mutation.error`** for fire-and-forget. Never assume mutation success.
5. **Use `useWalletProvider({ xChainId: chainKey })` from `@sodax/wallet-sdk-react` for every signed flow.** Pass the result into `mutate(vars).walletProvider`. Don't create or import any `*SpokeProvider` class — those don't exist in v2.

## DO

- **DO** call dapp-kit's exported hooks (which wrap `useSafeMutation`). Never call React Query's `useMutation` directly inside a wrapper around a dapp-kit hook — consumers depend on `mutateAsyncSafe`.
- **DO** branch on `mutateAsyncSafe`'s `Result.ok` for sequenced flows (`if (!hasAllowance) await approve(...); await action(...);`). User-rejects are modal, not exceptional.
- **DO** use `ChainKeys.X_MAINNET` constants for chain identifiers. Never hard-code chain key strings (`'sonic'`, `'0xa4b1.arbitrum'`).
- **DO** import everything from `@sodax/dapp-kit` (or `@sodax/sdk` for SDK-only types and constants — `@sodax/dapp-kit` re-exports them anyway).
- **DO** preserve literal chain keys in generic positions where possible (e.g. `srcChainKey: ChainKeys.ETHEREUM_MAINNET as const`) — TypeScript narrowing flows from the literal, including the `walletProvider` parameter type.
- **DO** use the canonical hook shape: queries take `{ params, queryOptions }`; mutations take only `{ mutationOptions }` and flow domain inputs through `mutate(vars)`.
- **DO** compose `onSuccess` instead of replacing it: `mutationOptions: { onSuccess: (data, vars, ctx) => myExtra(...) }` runs AFTER dapp-kit's hook-owned invalidations.

## DO NOT

- **DO NOT** call `useSpokeProvider` — it's deleted. v1 React consumers got a `SpokeProvider` from this hook; v2 has no such concept. Pass `walletProvider` directly into `mutate(vars)`.
- **DO NOT** treat mutation `data` as `Result<T>`. `mutationFn` calls `unwrapResult` and throws on `!ok`; `data` is the unwrapped success value (e.g. `SwapResponse`, `TxHashPair`). For SDK failures, look at `mutation.error` or use `mutateAsyncSafe`.
- **DO NOT** call `mutateAsync` without `try/catch`. It rejects on SDK `!ok`; an unhandled rejection lands in the global handler. Prefer `mutateAsyncSafe` for sequenced flows.
- **DO NOT** put `params`, `walletProvider`, or per-call config at the hook-init level. They go in `mutate(vars)` for mutations and in `params` for queries.
- **DO NOT** override `queryKey`, `queryFn`, or `enabled` via `queryOptions` — the hook owns those. The `queryOptions` slot is typed `Omit<UseQueryOptions, 'queryKey' | 'queryFn' | 'enabled'>`.
- **DO NOT** override `mutationFn` via `mutationOptions` — the hook owns it. Type prevents this.
- **DO NOT** import from `@sodax/dapp-kit/dist/...`. Deep-imports unstable; only the package root barrel is the public contract.
- **DO NOT** add `@sodax/types` as a separate dependency. It's re-exported transitively via `@sodax/sdk` (which dapp-kit re-exports). Adding it independently invites version skew.
- **DO NOT** recreate the v1 `invalidateMmQueries(...)` utility or anything similar. Each mutation hook invalidates the relevant keys in its own `onSuccess`. Add cross-feature invalidations via consumer `onSuccess`.
- **DO NOT** destructure cross-chain mutation results as arrays — `[a, b] = result.value` is wrong. The shape is `TxHashPair = { srcChainTxHash, dstChainTxHash }` (object). This applies to `useBridge`, `useStake`/`useUnstake`/etc., `useDexDeposit`/`useDexWithdraw`, all four MM mutations, and all four migration mutations.
- **DO NOT** use legacy chain-id constants (`BSC_MAINNET_CHAIN_ID`, etc.). They're gone in v2 — use `ChainKeys.X_MAINNET`.
- **DO NOT** reach for `as any` / `as IEvmWalletProvider` casts when wiring `useWalletProvider({ xChainId })` into mutation `mutate(vars)`. v2 supports the broad-union case structurally; the cast is not needed. See `recipes/wallet-connectivity.md` § "No type cast is needed".
- **DO NOT** send a zero or hand-picked minimum output (`minOutputAmount: 0n` or a literal). Derive it from a live quote for that exact input minus a slippage tolerance in basis points, show both to the user before they sign, and disable the action while there is no quote. The SDK does not reject a zero minimum (swaps and bridge only enforce the 546-sat dust floor on a BTC payout); a zero minimum accepts any fill.
- **DO NOT** add a `partnerFee` the integrator did not ask for. It is optional; omit it by default, and never copy a fee receiver address from a SODAX demo, doc, or example.
- **DO NOT** pass `skipSimulation: true` in user-facing flows. The simulation replays the hub-side execution and catches an intent that would revert there before the user signs it.

## Stop conditions (defer to user)

| Signal | Why stop |
|---|---|
| User wants a chain not in `ChainKeys.*` | Adding a new chain requires SDK-level changes — out of scope for consumer code. |
| User wants to use React Server Components / RSC patterns | dapp-kit is client-side React (uses React Query, hooks, browser APIs). Server Components don't run hooks. Tell the user the dapp-kit code goes in client components. |
| User wants to skip the wallet-sdk-react integration | If they have their own wallet abstraction, it's possible — they need to construct objects satisfying `I*WalletProvider` interfaces from `@sodax/sdk`. Refer them to the `sodax-sdk` (integration mode) skill (sibling under `@sodax/skills`) for non-React patterns. |
| User wants to use v1 dapp-kit (positional args, `useSpokeProvider`, `Result<T>` in success path) | Tell them to either upgrade or stay on v1. The shapes are not compatible. |

## Verification protocol

Before declaring a dapp-kit integration "done":

```bash
# 1. Type-check the consumer.
pnpm -C <consumer> tsc --noEmit

# 2. Confirm no leftover v1 patterns (if porting).
grep -rE '\buseSpokeProvider\b|\binvalidateMmQueries\b|_MAINNET_CHAIN_ID\b|\bxChainId\b' src/

# 3. Confirm all SDK-level mutation results are handled (either mutateAsyncSafe + result.ok branch
#    or mutateAsync wrapped in try/catch).
grep -rE 'mutateAsync\(' src/ | grep -v 'try\|catch\|mutateAsyncSafe'

# 4. Confirm all hooks are imported from @sodax/dapp-kit, not deep paths.
#    (matches `'@sodax/dapp-kit/dist'` and similar deep-import patterns)
grep -rE "@sodax/dapp-kit/[a-z]" src/   # zero hits expected (only the root path is public)
```

## Done criteria

- [ ] `SodaxProvider` + `QueryClientProvider` (preferably `createSodaxQueryClient()`) wired at the app root.
- [ ] Every mutation invocation uses `mutateAsyncSafe` (preferred), `mutateAsync` wrapped in `try/catch`, or fire-and-forget `mutate` with state read in render.
- [ ] No `useSpokeProvider`, no `invalidateMmQueries`, no `*_MAINNET_CHAIN_ID` constants, no `xChainId` outside known v2 hooks (e.g. `useXBalances` still uses `xChainId`).
- [ ] No `import` from `@sodax/dapp-kit/dist/...` or any other deep path.
- [ ] No standalone `@sodax/types` dependency in `package.json`.
- [ ] Consumer typecheck (`pnpm tsc --noEmit`) is clean.
