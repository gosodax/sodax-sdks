---
name: sodax-sdk-bridge-api
description: 'Granular skill for the @sodax/sdk v2 Bridge API client — `sodax.api.bridge` (class BridgeApiService), a typed HTTP client for the backend Bridge API (`/bridge/*`: tokens, allowance/approve, create-bridge-intent, submit-tx + status, fee/bridgeable-amount/bridgeable discovery). Every method returns Promise<Result<T>>, never throws, and validates the response. Use when the task calls the bridge backend directly (e.g. "sodax.api.bridge", "createBridgeIntent via the backend API", "submit bridge tx", "poll bridge submit-tx status", "bridge API v2", "point bridge at a custom endpoint", "bridge.useBackendSubmitTx"). For the higher-level end-to-end bridge orchestrator use the `bridge` skill instead. Skill links into the parent sodax-sdk knowledge tree.'
---

# Bridge API (Core SDK granular skill)

Granular skill for `sodax.api.bridge` (class `BridgeApiService`) — the typed HTTP client for the backend
**Bridge API** (`/bridge/*`). `sodax.api` is an alias for `sodax.backendApi`; `.bridge` is the bridge
client. One method per endpoint; every method returns `Promise<Result<T>>` (never throws) and
validates the response. Errors carry `feature: 'backend'`, `context.api: 'bridge'`, `context.endpoint`.

> Lower-level than `sodax.bridge`: this is the raw backend HTTP surface. For the end-to-end
> deposit→relay bridge orchestrator, use the [`bridge`](../bridge/SKILL.md) skill. The Bridge API mirrors
> the [`swaps-api`](../swaps-api/SKILL.md) client minus the solver/intent surface.

## Step 1 — Clarify with user before coding

1. **Which endpoint(s)?** Tokens · allowance/approve/create-bridge-intent · submit-tx/status · fee/bridgeable-amount/bridgeable discovery.
2. **Orchestrator or raw API?** If the user just wants "do a bridge", prefer `sodax.bridge` (the `bridge`
   skill). Use `sodax.api.bridge` when they need a single backend call or are building their own flow.
3. **Backend availability.** The `/bridge/*` routes are the newest backend surface; confirm the target host
   actually serves them (the on-chain `sodax.bridge` flow needs no backend).

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/features/bridge-api.md`](../integration/knowledge/features/bridge-api.md) — the full client: signatures, deltas vs swaps (no intent, FULL relayData envelope, 5-state tolerant status), common call shapes (create-intent, submit-tx + status), the read-only fee/bridgeable-amount/bridgeable discovery quotes, per-call overrides, `bridge.useBackendSubmitTx`.
3. For the end-to-end bridge flow that wraps these calls → [`../integration/knowledge/features/bridge.md`](../integration/knowledge/features/bridge.md); for the sibling swaps client → [`../integration/knowledge/features/swaps-api.md`](../integration/knowledge/features/swaps-api.md); for the read client (`sodax.backendApi`) → [`../integration/knowledge/features/backend-api.md`](../integration/knowledge/features/backend-api.md).
4. Errors are `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` → [`../integration/knowledge/recipes/result-and-errors.md`](../integration/knowledge/recipes/result-and-errors.md) and [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Bridge-API-specific anti-patterns

- **`try/catch` for failures.** Every method returns `Result<T>` — branch on `result.ok`. `catch` won't fire for HTTP/timeout/validation failures.
- **Passing `relayData.payload` to `submitTx`.** Unlike the swaps client, bridge `submitTx.relayData` is the FULL `{ address, payload }` object — pass `relayData` as-is (bridge has no `intent.creator` for the backend to rebuild the relay address).
- **Expecting an `intent` / `intent_hash`.** `createBridgeIntent` returns `{ tx, relayData }` only; submit-tx status terminal success is `status === 'executed' && result.dstIntentTxHash` (no solver `intent_hash`, no `'posting_execution'` state).
- **Calling `getSubmitTxStatus` with only `txHash`.** Both `txHash` AND `srcChainKey` are required.
- **Using SDK-domain param names in the body.** The wire DTO uses swaps naming (`inputToken`/`outputToken`/`inputAmount`/`srcAddress`/`dstAddress`); map SDK-domain `srcToken`/`dstToken`/`amount`/`recipient` via `toCreateBridgeIntentParamsV2`.
- **Round-tripping the discovery quotes when a local read suffices.** `getFee` / `getBridgeableAmount` / `isBridgeable` are computable client-side — prefer `sodax.bridge.getFee` / `getBridgeableAmount` / `isBridgeable` (no network hop). Their backend endpoints exist (mirrored on this client) mainly for non-SDK HTTP callers / parity; the token *list*, by contrast, is only backend-served.
- **Confusing `sodax.api.bridge` with `sodax.bridge`.** The former is the backend HTTP client; the latter is the on-chain vault orchestrator.

## Migration workflow (on-chain → API)

There is **no v1 Bridge API** — the typed `sodax.api.bridge` client is v2-new. The relevant move is from the
on-chain `sodax.bridge.bridge()` orchestrator to the API client (or to the orchestrator's default-on backend
path via `bridge.useBackendSubmitTx`):

1. [`../integration/knowledge/features/bridge.md`](../integration/knowledge/features/bridge.md) — the on-chain `BridgeService` orchestrator and the `bridge.useBackendSubmitTx` toggle that routes its spoke-deposit through this API with a client-side fallback.
2. For the v1 → v2 reshape of the on-chain bridge itself (chain-key routing, `Result<T>`, error unions) → [`../migration-v1-to-v2/knowledge/features/bridge.md`](../migration-v1-to-v2/knowledge/features/bridge.md).

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.api.bridge.<method>(...)` call site has `if (!result.ok)`.
3. `submitTx.relayData` is the full `relayData` object (not `relayData.payload`); `getSubmitTxStatus` passes both `txHash` and `srcChainKey`.
4. Bodies use the wire DTO names (`inputToken`/`outputToken`/`inputAmount`/`dstAddress`), mapped from SDK-domain params.

## Related granular skills (same family)

- [`../bridge/SKILL.md`](../bridge/SKILL.md) — the end-to-end bridge orchestrator (`sodax.bridge`) that wraps these backend calls.
- [`../swaps-api/SKILL.md`](../swaps-api/SKILL.md) — the sibling swaps HTTP client this mirrors.
- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — the `sodax.backendApi` read client (intent / orderbook / money-market reads + config).

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
