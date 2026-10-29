---
name: sodax-sdk-swaps-api
description: 'Granular skill for the @sodax/sdk v2 Swaps API client — `sodax.api.swaps` (class SwapsApiService), a typed HTTP client for the backend Swaps API (`/swaps/*`, 21 endpoints: quote, deadline, allowance/approve, create-intent, intent submit/status/cancel/hash/packet/extra-data, limit orders, gas estimate, partner/solver fees, submit-tx + status). Every method returns Promise<Result<T>>, never throws, and validates the response. Use when the task calls the swaps backend directly (e.g. "get a swap quote from the Sodax backend", "sodax.api.swaps", "submit swap tx", "createIntent via the backend API", "poll submit-tx status", "swaps API v2", "point swaps at a custom endpoint", "approve and send the swap in one signature"), or must swap tokens the installed SDK does not bundle ("unsupported token_src", "backend token list without upgrading the SDK"). For the higher-level swap orchestrator, which accepts only bundled tokens, use the `swap` skill instead. Skill links into the parent sodax-sdk knowledge tree.'
---

# Swaps API (Core SDK granular skill)

Granular skill for `sodax.api.swaps` (class `SwapsApiService`) — the typed HTTP client for the backend
**Swaps API** (`/swaps/*`). `sodax.api` is an alias for `sodax.backendApi`; `.swaps` is the swaps
client. 21 endpoints, one method each; every method returns `Promise<Result<T>>` (never throws) and
validates the response. Errors carry `feature: 'backend'`, `context.api: 'swaps'`, `context.endpoint`.

> Lower-level than `sodax.swaps`: this is the raw backend HTTP surface. For the end-to-end
> create→relay→post-execution swap orchestrator, use the [`swap`](../swap/SKILL.md) skill.

## Step 1 — Clarify with user before coding

1. **Which endpoint(s)?** Tokens · quote/deadline · allowance/approve/create-intent · intent lifecycle
   (submit/status/cancel/hash/packet/extra-data/fill/get) · limit-orders/gas/fees · submit-tx/status.
2. **Orchestrator or raw API?** `sodax.swaps` (the `swap` skill) accepts only tokens bundled with the
   installed `@sodax/sdk` (`unsupported token_src` / `token_dst` otherwise). Use `sodax.api.swaps` end to
   end for tokens newer than the installed SDK, where the backend validates, or for a single backend call
   (a quote, a fee, a status poll). Otherwise prefer `sodax.swaps` for "do a swap".
3. **Custom endpoint?** Does the swaps API live at a different host than the base backend API? If so, the
   `CustomApiConfig` variant is needed (see anti-patterns + the feature doc).

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/features/swaps-api.md`](../integration/knowledge/features/swaps-api.md) — the full 21-endpoint client: signatures, wire shapes (bigint vs decimal string), common call shapes (quote, create-intent, submit-tx + status), per-call overrides, custom endpoint, and sending the approval and the intent tx in one EIP-5792 signature.
3. For the SDK swap flow (local token checks; only its submit-tx leg calls this API) → [`../integration/knowledge/features/swap.md`](../integration/knowledge/features/swap.md); for the sibling read client (`sodax.backendApi`) → [`../integration/knowledge/features/backend-api.md`](../integration/knowledge/features/backend-api.md).
4. Errors are `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` → [`../integration/knowledge/recipes/result-and-errors.md`](../integration/knowledge/recipes/result-and-errors.md) and [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Swaps-API-specific anti-patterns

- **Omitting `partnerFee` on `getQuote` / `createIntent`.** Optional on the type only — no backend/SDK default. Ask for a real fee receiver; never invent one or use the zero address.
- **`try/catch` for failures.** Every method returns `Result<T>` — branch on `result.ok`. `catch` won't fire for HTTP/timeout/validation failures.
- **Passing the `RelayExtraData` object** to `submitTx`'s `relayData`. The field is a `string` — pass `relayData.payload`.
- **Passing `createIntent`'s `intent` straight to `submitTx`.** It is `IntentResponseV2` (decimal strings); `submitTx` takes `IntentRequestV2` (bigint). Convert it with `toIntentRequest` ([`features/swaps-api.md`](../integration/knowledge/features/swaps-api.md) § "Submit tx + poll status"); don't stringify bigints yourself.
- **Approving, waiting, then signing the intent tx on an EVM source.** On 2.2.0 that sequence is the only one. On 2.3.0+, where the wallet supports EIP-5792, `sendApprovalBatch` (new in 2.3.0) sends `[resetTx?, tx, intentTx]` as one batch (one signature): `features/swaps-api.md` § "Approve and send the intent in one signature". Never re-send a batch that returned `ATOMIC_BATCH_UNCONFIRMED`; resume it with `confirmApprovalBatch`.
- **Calling `getSubmitTxStatus` with only `txHash`.** Both `txHash` AND `srcChainKey` are required.
- **Confusing `sodax.api.swaps` with `sodax.swaps`.** The former is the backend HTTP client; the latter is the on-chain intent orchestrator.

## Migration workflow (v1 → v2)

The typed `sodax.api.swaps` client is **v2-new** (v1 had no equivalent typed swaps client — quotes went
through the solver and submit-tx lived on `sodax.backendApi.submitSwapTx`). The relevant v1 → v2 deltas it
builds on are covered in the existing swap + backend-api migration docs:

1. [`../migration-v1-to-v2/knowledge/features/swap.md`](../migration-v1-to-v2/knowledge/features/swap.md) — create-intent / submit-tx request-shape changes (`srcChainId` → `srcChainKey`, `relayData` object → string, bigint intent).
2. [`../migration-v1-to-v2/knowledge/features/backend-api.md`](../migration-v1-to-v2/knowledge/features/backend-api.md) — submit-tx moved off `BackendApiService` onto `sodax.api.swaps.submitTx`, and the `Result`-wrapping contract.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.api.swaps.<method>(...)` call site has `if (!result.ok)`.
3. `submitTx.relayData` is `relayData.payload` (string); `getSubmitTxStatus` passes both `txHash` and `srcChainKey`.
4. Every `getQuote` / `createIntent` body carries the same `partnerFee` (real receiver), or the user said they are not monetizing.
5. The `intent` given to `submitTx` is an `IntentRequestV2` (bigint) converted from `createIntent`'s `IntentResponseV2`; no manual `.toString()`.
6. Tokens offered to users come from `getTokens()`, not from `sodax.config` or `getSupportedSolverTokens`, when the flow must accept tokens newer than the installed SDK.

## Related granular skills (same family)

- [`../swap/SKILL.md`](../swap/SKILL.md) — the swap orchestrator (`sodax.swaps`): it validates tokens locally and uses this API only for submit-tx.
- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — the sibling `sodax.backendApi` read client (intent / orderbook / money-market reads + config).

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
