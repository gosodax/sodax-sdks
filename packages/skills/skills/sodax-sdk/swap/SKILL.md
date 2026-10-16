---
name: sodax-sdk-swap
description: 'Granular skill for the @sodax/sdk v2 swap feature only — intent-based swaps via solver (market orders + limit orders) and cancel/approve flows. Use when the consumer has decided the task is a swap (e.g. "swap with Sodax", "Sodax intent swap", "limit order on Sodax", "cross-chain swap via Sonic", "cancel a Sodax intent") and you want to skip loading the broad sodax-sdk skill. Covers BOTH integration (write new v2 swap code) and migration (port v1 swap to v2) — picks via Step 1 question. Skill is intentionally short and links into the parent sodax-sdk knowledge tree (../integration/knowledge/, ../migration-v1-to-v2/knowledge/) for full reference. For React dapps doing swaps, prefer the sodax-dapp-kit skill instead.'
license: MIT
metadata:
  version: '0.0.1'
  author: sodax
---

# Swap (Core SDK granular skill)

Granular skill for the swap feature of `@sodax/sdk` v2. Source-of-truth reference lives in the parent broad skill's knowledge tree — this file is the focused workflow only.

## Step 1 — Clarify with user before coding

Swap has materially different code paths depending on the answers. Don't skip:

1. **Are you writing new code, or porting v1 code to v2?**
   - New code → § Integration workflow below.
   - Port v1 → v2 → § Migration workflow.
2. **Signed flow (frontend wallet, browser/RN) or unsigned-tx flow (backend / custom relay)?**
   - Signed → `raw: false` + `walletProvider`.
   - Unsigned → `raw: true`, you handle relay yourself.
3. **One-shot `swap()` or step-by-step (`createIntent` → backend submit → `postExecution`)?**
   - One-shot is the default for frontends. If the token may need an approval, prefer `swapWithApproval()` — it approves only when needed, and on an EIP-5792 wallet does approve + swap in one signature (`getApprovalStrategy()` tells you which path it will take). A wallet that must first upgrade the account (`'ready'`) prompts for it; pass `allowAccountUpgrade: false` to skip that and approve separately, e.g. after a `USER_REJECTED` with `context.reason === ACCOUNT_UPGRADE_DECLINED`. Step-by-step is for backends that already have a relay/orchestration layer.
   - Step-by-step code must reproduce BOTH paths `swap()` runs internally — the backend submit-tx attempt *and* the client-side relay fallback on any non-success. The helpers behind `swap()` are package-internal, so the loop is hand-written: [`../integration/knowledge/recipes/manual-submit-tx-with-fallback.md`](../integration/knowledge/recipes/manual-submit-tx-with-fallback.md).
4. **Market order or limit order?** Limit orders use a different params shape — `deadline` becomes optional (forced to `0n` internally), not required.

## Integration workflow (writing new v2 swap code)

Read in order. Skipping `ai-rules.md` is the most common cause of agents reverting to v1 patterns.

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT list.
2. [`../integration/knowledge/features/swap.md`](../integration/knowledge/features/swap.md) — `SwapService` API surface, action params, return shapes, error codes (`feature: 'swap'`).
3. Path-specific recipe:
   - Signed one-shot → [`../integration/knowledge/recipes/signed-tx-flow.md`](../integration/knowledge/recipes/signed-tx-flow.md)
   - Backend step-by-step → [`../integration/knowledge/recipes/raw-tx-flow.md`](../integration/knowledge/recipes/raw-tx-flow.md) + [`../integration/knowledge/recipes/backend-server-init.md`](../integration/knowledge/recipes/backend-server-init.md)
4. Error handling for swap-specific codes (`INTENT_CREATION_FAILED`, `EXECUTION_FAILED`, `RELAY_TIMEOUT`, solver-side `EXTERNAL_API_ERROR`) → [`../integration/knowledge/recipes/result-and-errors.md`](../integration/knowledge/recipes/result-and-errors.md) and [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).
5. Cross-chain destination quirks (Stellar trustline, BTC PSBT, Solana PDA) → [`../integration/knowledge/chain-specifics.md`](../integration/knowledge/chain-specifics.md).
6. Reading swap status → [`../integration/knowledge/features/swap.md`](../integration/knowledge/features/swap.md) § Reading swap status. Default to `getDetailedStatus({ srcChainKey, srcTxHash })` (works whichever completion path ran) and collapse it with `summarizeSwapStatus`.

### Swap-specific anti-patterns

- **`try { await sodax.swaps.swap(...) } catch` for SDK-level failures.** v2 returns `Result<T>` — branch on `result.ok`. `catch` only fires for thrown exceptions (e.g. missing `walletProvider`), not for `RELAY_TIMEOUT` or `EXECUTION_FAILED`.
- **Forgetting the discriminator.** `raw: false` is required on signed swaps; without it TypeScript rejects `walletProvider`.
- **Reporting a swap as lost on a post-broadcast failure.** `TX_VERIFICATION_FAILED`, the relay codes and postExecution failures carry `error.context.srcTxHash` — the backend may still complete the swap, so keep polling `getDetailedStatus` with it.
- **Calling `sodax.api.swaps.submitTx` with the full `relayData` object.** The backend expects the `payload: string` field, not the wrapper.

## Migration workflow (port v1 swap to v2)

1. [`../migration-v1-to-v2/knowledge/ai-rules.md`](../migration-v1-to-v2/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../migration-v1-to-v2/knowledge/features/swap.md`](../migration-v1-to-v2/knowledge/features/swap.md) — v1 → v2 swap port playbook.
3. Cross-cutting renames (apply repo-wide before swap-specific edits) → [`../migration-v1-to-v2/knowledge/breaking-changes/type-system.md`](../migration-v1-to-v2/knowledge/breaking-changes/type-system.md).
4. Error code crosswalk (v1 `IntentError` → v2 `SodaxError<C>` with `feature: 'swap'`) → [`../migration-v1-to-v2/knowledge/reference/error-code-crosswalk.md`](../migration-v1-to-v2/knowledge/reference/error-code-crosswalk.md).

## Verification

1. `pnpm tsc --noEmit` from the consumer repo exits clean.
2. Every `await sodax.swaps.<method>(...)` call site has `if (!result.ok)` branching.
3. No `xToken.xChainId`, no `*_MAINNET_CHAIN_ID`, no `*SpokeProvider` references (migration only).
4. `isSodaxError(e)` (not bare `instanceof SodaxError`) in cross-bundle code.

## Related granular skills (same family)

- [`../money-market/SKILL.md`](../money-market/SKILL.md) — if the swap is followed by a supply/borrow action.
- [`../partner/SKILL.md`](../partner/SKILL.md) — partner fees on swap.
- [`../recovery/SKILL.md`](../recovery/SKILL.md) — stuck-asset recovery for failed swaps.
- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — `sodax.api.swaps.submitTx` and intent / orderbook lookups (step-by-step swap flow + diagnostics).
- [`../swaps-api/SKILL.md`](../swaps-api/SKILL.md) — the typed Swaps API backend client (`sodax.api.swaps`: quote, create-intent, submit-tx, fees) the swap flow calls under the hood.

For tasks spanning multiple features, load the broad [`sodax-sdk` skill](../SKILL.md) instead.

## Wallet provider (different SDK package family)

This skill treats `walletProvider` as a contract (`IEvmWalletProvider` etc.) — it does not instantiate one. For Node bots / scripts / non-React backends that need a wallet implementation (private-key EVM, Solana keypair, Stellar SDK, etc.), **also load the `sodax-wallet-sdk-core` skill (integration mode)**. That package ships ready-made `I*WalletProvider` classes for all 9 chain families.
