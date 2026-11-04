---
name: sodax-dapp-kit
description: 'Integrate SODAX into a React dapp with @sodax/dapp-kit — React Query hooks for swaps, money market lending/borrowing, staking, bridging, DEX liquidity, leverage-yield vaults (deposit/withdraw, APR / TVL / health) and leverage positions, token migration, Bitcoin trading (Radfi / Bound Exchange), partner fees, recovery, and backend API reads. INTEGRATION (write NEW code) — use whenever a React dapp needs SODAX feature hooks; backend code uses `@sodax/sdk`. Triggers on "use @sodax/dapp-kit", "useSwap", "useMoneyMarket", "useStake", "useBridge", "useDex", "useMigrate", "useLeverageYield", "leverage yield vault in React", "vault UI", any dapp-kit `use<Feature>` hook, "Sodax React hooks". v2 hook shape: mutation hooks return `SafeUseMutationResult` with `mutateAsyncSafe(vars): Promise<Result<TData>>`; mutationFn throws on SDK `!ok`; hooks own their invalidations. MIGRATION (port v1 → v2) — single-object hook params, mandatory `mutateAsyncSafe`, hook-owned invalidations, canonical queryKey/mutationKey conventions, on top of the reshaped SDK (chain-key-driven routing, `Result<T>` everywhere, `WalletProviderSlot<K, Raw>`). Triggers on "migrate @sodax/dapp-kit", "useSpokeProvider gone", "dapp-kit v1 → v2", "invalidateMmQueries broken", "dapp-kit hook signatures changed", v1 fingerprints (positional args, hook-init `spokeProvider`, `useSpokeProvider`, `invalidateMmQueries`, legacy `useMigrate`, `*_MAINNET_CHAIN_ID`). Load this skill if EITHER applies; the body gates by mode.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# When to use this skill

AGENTS.md routes you here when you're working with `@sodax/dapp-kit` v2 — either writing new code or porting from v1.

**Pick your mode:**

- Writing NEW v2 code (greenfield dapp-kit usage, no v1 hooks)? → § **Integration mode** below.
- Porting EXISTING v1 code to v2 (grep finds `useSpokeProvider`, `invalidateMmQueries`, legacy `useMigrate`, `*_MAINNET_CHAIN_ID`)? → § **Migration mode** below.
- Both? → migration first, then integration. Stale v1 patterns leak into new code if you skip it.

For backend / Node → use `sodax-sdk` (dapp-kit is React-only).
Every dapp-kit consumer also needs wallet connectivity — also load `sodax-wallet-sdk-react`.

## Prefer a granular skill if the feature is known

If the user has already picked one feature, load the matching granular skill instead of this broad one. It is a few KB of focused workflow and links straight into the right knowledge files, for integration and, where a v1 surface existed, migration.

| Feature | Granular skill | Trigger phrases |
|---|---|---|
| Intent-based swap (market + limit orders) | [`./swap/SKILL.md`](./swap/SKILL.md) | "useSwap", "useQuote", "limit order in React" |
| Cross-chain lending / borrowing | [`./money-market/SKILL.md`](./money-market/SKILL.md) | "useSupply", "useBorrow", "money market UI" |
| SODA ↔ xSODA staking | [`./staking/SKILL.md`](./staking/SKILL.md) | "useStake", "instant unstake", "staking UI" |
| Direct token bridge via vault | [`./bridge/SKILL.md`](./bridge/SKILL.md) | "useBridge", "bridge tokens in React" |
| Concentrated-liquidity LP | [`./dex/SKILL.md`](./dex/SKILL.md) | "useSupplyLiquidity", "LP position UI", "usePools" |
| Leverage-yield vaults and leverage positions (on-chain hooks; a user-facing vault screen starts from the [product anatomy](./integration/knowledge/recipes/leverage-yield-product-anatomy.md)) | [`./leverage-yield/SKILL.md`](./leverage-yield/SKILL.md) | "leverage yield vault", "vault UI / screen / dashboard", "deposit into a vault", "lsoda shares", "vault APR / TVL", "useLeverageYieldDeposit", "useLeverageYieldVaultSwap", "open a leverage position" |
| ICX / bnUSD / BALN token migration | [`./migration/SKILL.md`](./migration/SKILL.md) | "useMigrateIcxToSoda", "migrate bnUSD" (NOT v1→v2 porting) |
| Bitcoin trading via Radfi | [`./bitcoin/SKILL.md`](./bitcoin/SKILL.md) | "useRadfiAuth", "trading wallet", "Bound Exchange" |
| Partner fees, recovery, backend reads, the Swaps / Bridge / Leverage Yield API hooks, Stellar account activation, shared utilities (balances, gas, trustlines) | [`./auxiliary-services/SKILL.md`](./auxiliary-services/SKILL.md) | "useFeeClaimSwap", "useWithdrawHubAsset", "useBackendIntentByTxHash", "useSwapsApiQuote", "useLeverageYieldApi*", "useStellarGate", "useXBalances" |

Load this broad skill (keep reading below) when the feature is undecided, the task spans several features, or the consumer is porting a full v1 codebase.

---

## Integration mode (writing new v2 code)

Pick this mode when the consumer is a React dapp using `@sodax/dapp-kit` hooks. Common signals:

- Any feature hook: `useSwap`, `useMoneyMarket*`, `useStake`, `useBridge`, `useDex*`, `useLeverageYield*`, `useMigrate*`, `useRadfi*`, `usePartner*`, `useRecovery*`.
- "Wire React Query for SODAX" — `SodaxProvider`, `createSodaxQueryClient`.
- "Branch on mutation result without try/catch" — `mutateAsyncSafe`.
- "Custom invalidation on success" — consumer-provided `onSuccess` (note: hook-owned invalidations already run; yours runs *after*).

### Workflow

1. Read [`integration/knowledge/ai-rules.md`](./integration/knowledge/ai-rules.md) — DO / DO NOT / workflow / stop conditions.
2. Read [`integration/knowledge/quickstart.md`](./integration/knowledge/quickstart.md) — install + wire providers + first feature.
3. Read [`integration/knowledge/architecture.md`](./integration/knowledge/architecture.md) — hook shapes, queryKey conventions, `useSafeMutation`, `unwrapResult`, `Result<T>`.
4. For each feature you use, read [`integration/knowledge/features/`](./integration/knowledge/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `leverage-yield.md` (vaults + leverage positions), `migration.md`, `bitcoin.md` (Bound Exchange, dapp-kit-unique), `auxiliary-services.md` (partner + recovery + backend + shared).
5. Recipes → [`integration/knowledge/recipes/`](./integration/knowledge/recipes/) — `setup.md`, `wallet-connectivity.md`, per-feature, `mutation-error-handling.md`, `observability.md`, `invalidations.md`. Building a user-facing leverage-yield vault screen → [`leverage-yield-product-anatomy.md`](./integration/knowledge/recipes/leverage-yield-product-anatomy.md).
6. Lookups → [`integration/knowledge/reference/`](./integration/knowledge/reference/) — `hooks-index.md`, `querykey-conventions.md`, `public-api.md`, `glossary.md`.

### v2 in one minute

1. **Hooks accept a single object with one or two top-level keys.** Mutation hooks take only `{ mutationOptions }` at hook-init; query hooks take `{ params, queryOptions }`. ALL domain inputs (`params`, `walletProvider`, per-call config) flow through `mutate(vars)` for mutations.
2. **Every mutation hook returns `SafeUseMutationResult`** — extends React Query's `UseMutationResult` with `mutateAsyncSafe(vars): Promise<Result<TData>>` (never rejects). Use `mutateAsyncSafe` for sequenced flows; `mutateAsync` for try/catch flows; `mutate` for fire-and-forget render-driven flows.
3. **`mutationFn` throws on SDK `!ok`.** dapp-kit calls `unwrapResult` on the SDK's `Result<T>`, throwing on failure. This makes React Query's native error model engage (`isError`, `error`, `onError`, `retry`, devtools). `mutateAsyncSafe` packages the throw back into `Result<T>` for ergonomic branching.
4. **Hook-owned invalidations.** Each mutation hook invalidates the relevant query keys in its `onSuccess`, derived from `vars`. Consumer-provided `onSuccess` runs after. v1's manual `invalidateMmQueries` utilities are gone.
5. **Canonical queryKey shape.** `[feature, action, ...identifiers]`. First segment matches the directory name (`swap`, `mm`, `bridge`, `staking`, `dex`, `leverageYield`, `bitcoin`, `partner`, `recovery`, `backend`, `shared`, `migrate`). camelCase. Bigints stringified.

### Conventions agents must follow (integration)

- **Use dapp-kit's exported hooks.** Don't wrap with React Query's `useMutation` directly — consumers depend on `mutateAsyncSafe`.
- **Branch on `mutateAsyncSafe`'s `Result.ok` for sequenced flows.** The user-reject case is modal, not exceptional.
- **`ChainKeys.*` over hard-coded chain strings.** The set evolves per release.
- **Drop `spokeProvider`.** It's not a v2 concept. `walletProvider` flows through `mutate(vars)` for signed flows.
- **Don't recreate hook-owned invalidations.** Each mutation hook already invalidates the relevant keys; consumer `onSuccess` runs after for any extra logic.
- Import only from the package root: `import { useSwap, SodaxProvider, createSodaxQueryClient } from '@sodax/dapp-kit'`. dapp-kit re-exports `@sodax/sdk`'s public surface (`ChainKeys`, `SodaxConfig`, types) — you can import them from dapp-kit directly.
- Don't add `@sodax/types` as a dependency — re-exported via `@sodax/sdk`.

### Top traps to avoid (integration)

1. **Reaching for `useSpokeProvider`.** Deleted. Pass `walletProvider` from `useWalletProvider({ xChainId: chainKey })` (`@sodax/wallet-sdk-react`) directly into `mutate(vars)`.
2. **Treating mutation `data` as `Result<T>`.** v2's `mutationFn` unwraps before resolving — `data` is the unwrapped success value (e.g. `SwapResponse`, `TxHashPair`). For SDK failures, look at `mutation.error` or use `mutateAsyncSafe` for the `Result<T>` shape.
3. **Forgetting `try/catch` on `mutateAsync`.** v2's `mutateAsync` rejects on SDK `!ok`. Prefer `mutateAsyncSafe` (never rejects).
4. **Hook-level `spokeProvider` / `params`.** v1 hooks took these positionally or at hook-init. v2 hooks take only `{ mutationOptions }` (mutations) or `{ params, queryOptions }` (queries). All domain inputs live in `mutate(vars)` for mutations.
5. **Reading `xToken.xChainId` or hard-coding `*_MAINNET_CHAIN_ID`.** SDK leakage — these were renamed: `XToken.chainKey`, `ChainKeys.X_MAINNET`.

### Verification (integration)

```bash
pnpm tsc --noEmit   # must exit clean
```

In browser:
- Successful mutations populate `data` with the unwrapped success value.
- SDK `!ok` errors arrive via `mutation.error` (when using `mutate` / `mutateAsync`) or as `result.ok === false` (when using `mutateAsyncSafe`).
- React Query devtools show hook-owned invalidations firing on success.

---

## Migration mode (v1 → v2 porting)

Pick this mode when the consumer has v1 dapp-kit patterns. Grep signals:

```bash
grep -rE 'useSpokeProvider|invalidateMmQueries|useMigrate\b' src/
grep -rE '_MAINNET_CHAIN_ID\b|\bxChainId\b' src/
```

If the project has both v1 patterns AND wants new features: **migration first, then integration**. Stale v1 patterns leak into new code if you skip it.

The SDK underneath also changed — load the `sodax-sdk` skill (migration mode) alongside this one (the migration trees cross-link).

### Workflow

1. Read [`migration-v1-to-v2/knowledge/ai-rules.md`](./migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT / workflow / stop conditions.
2. Read [`migration-v1-to-v2/knowledge/README.md`](./migration-v1-to-v2/knowledge/README.md) — overview, reading order, glossary.
3. Walk [`checklist.md`](./migration-v1-to-v2/knowledge/checklist.md) — top-down cross-cutting steps.
4. **Cross-cutting breaking changes** in order:
   - [`breaking-changes/hook-signatures.md`](./migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md) — single-arg policy + `ReadHookParams` / `MutationHookParams`.
   - [`breaking-changes/result-handling.md`](./migration-v1-to-v2/knowledge/breaking-changes/result-handling.md) — `Result<T>` success-path → throws; `mutateAsyncSafe`.
   - [`breaking-changes/querykey-conventions.md`](./migration-v1-to-v2/knowledge/breaking-changes/querykey-conventions.md) — camelCase + default mutationKey.
   - [`breaking-changes/sdk-leakage.md`](./migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md) — cross-links to SDK migration tree.
5. **Per-feature playbooks** under [`features/`](./migration-v1-to-v2/knowledge/features/) — `swap.md`, `money-market.md`, `staking.md`, `bridge.md`, `dex.md`, `migration.md`, `bitcoin.md`, `auxiliary-services.md`.
6. **Codemods + adapters** → [`recipes.md`](./migration-v1-to-v2/knowledge/recipes.md).
7. **Reference** → [`reference/`](./migration-v1-to-v2/knowledge/reference/) — `deleted-hooks.md` (e.g. `useSpokeProvider`, `invalidateMmQueries`, legacy `useMigrate`), `renamed-hooks.md`, `error-shape-crosswalk.md`.

### Top traps to avoid (migration)

1. **Reaching for `useSpokeProvider`.** Deleted. Pass `walletProvider` from `useWalletProvider({ xChainId: chainKey })` (`@sodax/wallet-sdk-react`) directly into `mutate(vars)`.
2. **Treating mutation `data` as `Result<T>`.** v2's `mutationFn` unwraps before resolving — `data` is the unwrapped success value.
3. **Forgetting `try/catch` on `mutateAsync`.** v2's `mutateAsync` rejects on SDK `!ok`. Prefer `mutateAsyncSafe` (never rejects).
4. **Hook-level `spokeProvider` / `params`.** v1 hooks took these positionally or at hook-init. v2 hooks take only `{ mutationOptions }` (mutations) or `{ params, queryOptions }` (queries). All domain inputs live in `mutate(vars)` for mutations.
5. **Reading `xToken.xChainId` or hard-coding `*_MAINNET_CHAIN_ID`.** SDK leakage. Renamed: `XToken.chainKey`, `ChainKeys.X_MAINNET`.

### Verification (migration)

```bash
pnpm tsc --noEmit   # must exit clean
grep -rE 'useSpokeProvider|invalidateMmQueries\b' src/   # empty
```

Manual:
- Sequenced flows use `mutateAsyncSafe` and branch on `result.ok`.
- React Query devtools show hook-owned invalidations on success (consumer `onSuccess` runs after, doesn't duplicate them).

---

# Related skills

- `sodax-wallet-sdk-react` — wire the wallet, get the `walletProvider` to feed into dapp-kit `mutate(vars)`.
- `sodax-sdk` — for any direct SDK call alongside dapp-kit hooks (and where the SDK-level v1 → v2 work happens).
