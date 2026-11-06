---
name: sodax-dapp-kit-money-market
description: 'Granular skill for the @sodax/dapp-kit v2 money-market feature only — React Query hooks for cross-chain lending/borrowing: useSupply, useBorrow, useWithdraw, useRepay, useMMAllowance, useMMApprove, plus reserves/position reads (useReservesHumanized, useUserFormattedSummary, useUserReservesData, useAToken, useATokensBalances). Use when a React dapp task is specifically money-market (e.g. "useSupply with dapp-kit", "borrow hook", "render health factor in React", "Sodax lending hooks", "withdraw collateral hook"). Covers BOTH integration (new v2 hooks) and migration (port v1 MM hooks — single-object params, srcChainKey/srcAddress required, mutateAsyncSafe). Links into the parent sodax-dapp-kit knowledge tree. For backend/Node, use the sodax-sdk skill.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Money Market (dapp-kit granular skill)

Granular skill for the lending/borrowing hooks of `@sodax/dapp-kit` v2. queryKey/mutationKey first segment: `mm`. React-only — backend uses `@sodax/sdk` directly.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Which action?** `useSupply`, `useBorrow`, `useWithdraw`, `useRepay`, or read-only (reserves / user position).
3. **Same-chain or cross-chain delivery?** All four actions accept optional `dstChainKey`/`dstAddress` (omit for same-chain; don't pass `dstChainKey === srcChainKey`).
4. **Need allowance gating?** `supply`/`repay` need approval (`useMMAllowance` + `useMMApprove`); `borrow`/`withdraw` never need ERC-20 approval (`useMMAllowance` is `enabled: false` for those → `data` stays `undefined`).
5. **Need position reads?** Reserve data (`useReservesHumanized` etc.) and user position (`useUserFormattedSummary`, `useUserReservesData`) — read hooks key on `spokeChainKey`, not `srcChainKey`.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/money-market.md`](../integration/knowledge/features/money-market.md) — full hook surface, mutation TVars (`{ params: MoneyMarketSupplyParams<K>, walletProvider }`), reserve/position read shapes, the `spokeChainKey` vs `srcChainKey` split.
4. [`../integration/knowledge/recipes/money-market.md`](../integration/knowledge/recipes/money-market.md) — full worked examples.
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Money-market-specific anti-patterns (dapp-kit)

- **Using `srcChainKey`/`srcAddress` on read hooks.** Those are mutation-side names. Position reads (`useATokensBalances`, `useUserFormattedSummary`, `useUserReservesData`) key on `spokeChainKey` + `userAddress`; the hub wallet is derived automatically. Don't grep-replace one for the other.
- **Treating `useMMAllowance` `undefined` as "not approved" for borrow/withdraw.** The query is `enabled: false` for those actions — `undefined` means "approval not required."
- **Passing the MM params directly under `params` on `useMMAllowance`.** They nest under `params.payload`.
- **Treating mutation `data` as `Result<T>`.** `data` is the unwrapped `TxHashPair = { srcChainTxHash, dstChainTxHash }` (`OutboundSettlement<K>` for `useBorrow` / `useWithdraw`).
- **Skipping a health-factor warning, or comparing it wrong.** `healthFactor` is a **string**, and a no-debt position returns the sentinel `'-1'` — so `Number(hf)` it and exclude `-1` before warning: `const hf = Number(summary.healthFactor); if (hf !== -1 && hf < 1.05) { /* warn */ }`. A raw `healthFactor < 1.05` is a TS error and would also flag a debt-free user.

## Migration workflow (port v1 MM hooks to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. Cross-cutting deltas: [`../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md`](../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md), [`../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md), [`../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md`](../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md) — `srcChainKey`/`srcAddress` now required.
3. [`../migration-v1-to-v2/knowledge/features/money-market.md`](../migration-v1-to-v2/knowledge/features/money-market.md) — add `srcChainKey`/`srcAddress` to every action; allowance auto-skip for borrow/withdraw.
4. `invalidateMmQueries` and friends are gone — hooks own their invalidations. See [`../migration-v1-to-v2/knowledge/reference/deleted-hooks.md`](../migration-v1-to-v2/knowledge/reference/deleted-hooks.md).

## Verification

1. `pnpm tsc --noEmit` clean.
2. Mutation flows use `mutateAsyncSafe` and branch on `result.ok`.
3. Read hooks use `spokeChainKey`/`userAddress` (not `srcChainKey`/`srcAddress`).
4. No `invalidateMmQueries`, no `useSpokeProvider` (migration only).

## Related granular skills (same family)

- [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md) — backend MM data reads (`useBackendMoneyMarketPosition`, suppliers/borrowers lists) that don't need a wallet.
- [`../swap/SKILL.md`](../swap/SKILL.md) — when supplying collateral that requires an upstream swap.

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md).

## Wallet connectivity (different SDK package family)

`walletProvider` flows through `mutate(vars)` for the action hooks. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire wallets and get a typed `walletProvider` via `useWalletProvider({ xChainId: chainKey })`.
