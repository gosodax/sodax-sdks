---
name: sodax-dapp-kit-swap
description: 'Granular skill for the @sodax/dapp-kit v2 swap feature only — React Query hooks for intent-based cross-chain swaps via the solver: useSwapLifecycle, useSwap, useSwapWithApproval, useSwapApprovalStrategy, useQuote, useSwapAllowance, useSwapApprove, useDetailedStatus, useStatus, useCreateLimitOrder, useCancelSwap, useCancelLimitOrder. Use when a React dapp has decided the task is a swap (e.g. "useSwap with dapp-kit", "Sodax React swap hook", "limit order hook", "poll swap status", "cancel a Sodax intent in React") and you want to skip loading the broad sodax-dapp-kit skill. Covers BOTH integration (write new v2 hooks) and migration (port v1 swap hooks to v2 — single-object params, mutateAsyncSafe, hook-owned invalidations). Picks via Step 1. Links into the parent sodax-dapp-kit knowledge tree. For backend/Node swaps (no React), use the sodax-sdk skill instead.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Swap (dapp-kit granular skill)

Granular skill for the swap hooks of `@sodax/dapp-kit` v2. React-only — backend/Node swaps use `@sodax/sdk` directly. Source-of-truth reference lives in the parent broad skill's knowledge tree; this file is the focused workflow only.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
   - New → § Integration workflow.
   - Port v1 → § Migration workflow.
2. **Which hooks?** A whole swap form → `useSwapLifecycle` (one `state` + `next()`; the hooks below are its parts and stay available). Otherwise: quote/preview (`useQuote`), execute (`useSwap`, or `useSwapWithApproval` to fold the approval in — one EIP-5792 signature where the wallet can batch; `useSwapApprovalStrategy` labels it; `allowAccountUpgrade: false` keeps a wallet that would ask for a smart-account upgrade on the two-step path), allowance gate (`useSwapAllowance` + `useSwapApprove`), status polling (`useDetailedStatus` from the source tx — the default; `useStatus` only when you hold the hub tx hash), or limit orders (`useCreateLimitOrder` / `useCancelLimitOrder`).
3. **Market order or limit order?** Limit orders use `useCreateLimitOrder` (no `deadline`; cancel manually via `useCancelLimitOrder`).
4. **Imperative flow or render-driven?** Sequenced flows → `mutateAsyncSafe` (returns `Result<T>`, never rejects). Fire-and-forget → `mutate`.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first; skipping it is the top cause of reverting to v1 hook shapes).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `SafeUseMutationResult`, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/swap.md`](../integration/knowledge/features/swap.md) — full hook surface, param shapes (`useQuote`/`useSwapAllowance` nest under `params.payload`; cancel hooks are FLAT), return shapes, polling intervals.
4. [`../integration/knowledge/recipes/swap.md`](../integration/knowledge/recipes/swap.md) — full worked example.
5. Call-shape choice (`mutate` / `mutateAsync` / `mutateAsyncSafe`) → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Swap-specific anti-patterns (dapp-kit)

- **Treating `useSwap` `data` as `Result<T>`.** The hook's `mutationFn` unwraps before resolving — `data` is the success value (`SwapResponse = { intent, intentDeliveryInfo, solverExecutionResponse }`). For SDK `!ok` read `mutation.error` or use `mutateAsyncSafe` for the `Result<T>` shape.
- **Passing the SDK request directly under `params` on `useQuote`.** It nests under `params.payload` (a `SolverIntentQuoteRequest`). `useSwapAllowance` nests `payload` + `srcChainKey` + `walletProvider` under `params`.
- **Reading `data.status` on `useQuote` / `useStatus` without `data?.ok`.** Both return a `Result<…>` as their `data` — branch on `.ok` first. (`useSwapAllowance` is the opposite — already-unwrapped `boolean`.)
- **`useStatus` key is `intentTxHash`, not `intentHash`.** It needs the **hub** tx; for a status from what `swap()` returns use `useDetailedStatus({ params: { srcChainKey, srcTxHash } })`.
- **Flattening `getSupportedSwapTokens()` and keying rows on `address`.** The same token address recurs across chains — use a composite `${address}-${chainKey}` key (`XToken` carries `chainKey`, not `blockchain_id`).
- **Reaching for `useSpokeProvider`.** Deleted. Pass `walletProvider` into `mutate(vars)` for `useSwap`/`useSwapApprove`; cancel hooks take it flat.

## Migration workflow (port v1 swap hooks to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. Cross-cutting deltas, in order: [`../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md`](../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md) (single-arg policy), [`../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md) (`mutateAsyncSafe`), [`../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md`](../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md).
3. [`../migration-v1-to-v2/knowledge/features/swap.md`](../migration-v1-to-v2/knowledge/features/swap.md) — v1 `useSwap(spokeProvider)`-style call sites → v2 `mutate({ params, walletProvider })`; approve return-shape change.
4. The SDK underneath also changed — also load the `sodax-sdk` skill (migration mode) for the raw swap-layer port.

## Verification

1. `pnpm tsc --noEmit` from the consumer repo exits clean.
2. Sequenced swap flows use `mutateAsyncSafe` and branch on `result.ok` (user-reject is modal, not exceptional).
3. `useQuote` / `useStatus` call sites branch on `data?.ok` before reading status fields.
4. No `useSpokeProvider`, no hook-level `spokeProvider`/`params` (migration only).
5. React Query devtools show hook-owned invalidations firing on success (consumer `onSuccess` runs after).

## Related granular skills (same family)

- [`../money-market/SKILL.md`](../money-market/SKILL.md) — if the swap feeds a supply/borrow action.
- [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md) — `useSwapsApiSubmitTx` / intent-tracking + orderbook reads (step-by-step swap + diagnostics), partner fee-claim swaps.

For tasks spanning multiple features, load the broad [`sodax-dapp-kit` skill](../SKILL.md) instead.

## Wallet connectivity (different SDK package family)

This skill treats `walletProvider` as an input flowing through `mutate(vars)`. Every dapp-kit consumer needs wallet connectivity — **also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire wallets and get a typed `walletProvider` per chain via `useWalletProvider({ xChainId: chainKey })`.
