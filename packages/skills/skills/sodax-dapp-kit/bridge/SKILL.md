---
name: sodax-dapp-kit-bridge
description: 'Granular skill for the @sodax/dapp-kit v2 bridge feature only — React Query hooks for cross-chain token transfer via the hub-and-spoke vault: useBridge, useBridgeApprove, useBridgeAllowance, useGetBridgeableAmount, useGetBridgeableTokens. Use when a React dapp task is specifically bridging (e.g. "useBridge with dapp-kit", "bridge tokens cross-chain in React", "check bridgeable amount hook", "list bridgeable destinations"). useBridge resolves to TxHashPair = { srcChainTxHash, dstChainTxHash }. Covers BOTH integration (new v2 hooks) and migration (port v1 bridge hooks — field renames srcChainId→srcChainKey / srcAsset→srcToken / dstAsset→dstToken, new required srcAddress, recipient unchanged, mutateAsyncSafe). Links into the parent sodax-dapp-kit knowledge tree. For backend/Node, use the sodax-sdk skill.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Bridge (dapp-kit granular skill)

Granular skill for the bridge hooks of `@sodax/dapp-kit` v2. queryKey/mutationKey first segment: `bridge`. React-only — backend uses `@sodax/sdk` directly.

## Step 1 — Clarify with user before coding

1. **New code or v1 → v2 port?**
2. **Need a bridgeable precheck?** `useGetBridgeableAmount` (vault deposit/withdrawal cap, returns a `BridgeLimit`) and `useGetBridgeableTokens` (enumerate compatible destinations).
3. **Allowance gating?** `useBridgeWithApproval` folds the approval in (one EIP-5792 batch when the wallet can), labelled with `useBridgeApprovalStrategy`. The two-step alternative is `useBridgeAllowance` + `useBridgeApprove` before `useBridge`.
4. **Source/destination chains + recipient format** — confirm both are supported spokes and the `recipient` matches the destination chain encoding.

## Integration workflow (new v2 code)

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/architecture.md`](../integration/knowledge/architecture.md) — hook shapes, `mutateAsyncSafe`, `unwrapResult`, queryKey conventions.
3. [`../integration/knowledge/features/bridge.md`](../integration/knowledge/features/bridge.md) — full hook surface, `CreateBridgeIntentParams` shape, `useBridgeAllowance` nesting, `BridgeLimit` return.
4. [`../integration/knowledge/recipes/bridge.md`](../integration/knowledge/recipes/bridge.md) — full worked example.
5. Call-shape choice → [`../integration/knowledge/recipes/mutation-error-handling.md`](../integration/knowledge/recipes/mutation-error-handling.md).

### Bridge-specific anti-patterns (dapp-kit)

- **Destructuring `useBridge` `data` as an array or single hash.** It resolves to `TxHashPair = { srcChainTxHash, dstChainTxHash }` — destructure by name.
- **Treating `useGetBridgeableAmount` `data` as a bare bigint.** It's a `BridgeLimit = { amount, decimals, type }` — read `data.amount` / `data.decimals`.
- **Passing addresses + chain ids to `useGetBridgeableAmount`.** It takes two `XToken` objects (each carries its own `chainKey`); v1's 4-arg shape is gone.
- **Passing the bridge params directly under `params` on `useBridgeAllowance`.** They nest under `params.payload` alongside `walletProvider`.
- **Submitting an incompatible token pair.** Tokens bridge only if they share the same hub vault — gate with `useGetBridgeableTokens` (incompatible pairs reject with `VALIDATION_FAILED`).

## Migration workflow (port v1 bridge hooks to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. Cross-cutting deltas: [`../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md`](../migration-v1-to-v2/knowledge/breaking-changes/hook-signatures.md), [`../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md`](../migration-v1-to-v2/knowledge/breaking-changes/result-handling.md), [`../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md`](../migration-v1-to-v2/knowledge/breaking-changes/sdk-leakage.md).
3. [`../migration-v1-to-v2/knowledge/features/bridge.md`](../migration-v1-to-v2/knowledge/features/bridge.md) — `useBridge` param renames (`srcChainId` → `srcChainKey`, `dstChainId` → `dstChainKey`, `srcAsset` → `srcToken`, `dstAsset` → `dstToken`; new required `srcAddress`; `recipient` is UNCHANGED — NOT renamed to `dstAddress`); `useGetBridgeableAmount` shape change (bigint → `BridgeLimit`).

## Verification

1. `pnpm tsc --noEmit` clean.
2. `useBridge` consumers destructure `{ srcChainTxHash, dstChainTxHash }` (no array/string).
3. `useGetBridgeableAmount` consumers read `data.amount` (not a scalar).
4. No `useSpokeProvider`, no `srcChainId`/`srcAsset`/`dstAsset` v1 field names (migration only); `recipient` stays `recipient` (do NOT rename to `dstAddress`).

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — intent-based cross-chain swaps (solver-routed; different from a direct vault bridge).
- [`../auxiliary-services/SKILL.md`](../auxiliary-services/SKILL.md) — recovery (`useWithdrawHubAsset`) for assets stranded on the hub after a failed bridge.

For multi-feature tasks, load the broad [`sodax-dapp-kit` skill](../SKILL.md).

## Wallet connectivity (different SDK package family)

`walletProvider` flows through `mutate(vars)`. **Also load the `sodax-wallet-sdk-react` skill (integration mode)** to wire wallets and get a typed `walletProvider` via `useWalletProvider({ xChainId: chainKey })`.
