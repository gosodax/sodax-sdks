---
name: sodax-sdk-leverage-yield-api
description: 'Granular skill for the @sodax/sdk v2 Leverage Yield API client — `sodax.api.leverageYield` (class LeverageYieldApiService), a typed HTTP client for the backend Leverage Yield API (`/leverage-yield/*`, 33 endpoints: vault registry, vault reads (asset/position/APR/effective-APR/LSD-APR/total-assets/previews/share-balance/max-withdraw), deposit & withdraw quote, deadline, allowance/approve, create-deposit-intent & create-withdraw-intent, intent submit/status/cancel/hash/packet/extra-data/fill/get, gas estimate, partner/solver fees, submit-tx + status). Every method returns Promise<Result<T>>, never throws, and validates the response. Use when the task calls the leverage-yield backend directly (e.g. "sodax.api.leverageYield", "leverage vault APR from the backend", "vault position from the API", "leverage-yield deposit quote", "createDepositIntent via the backend API", "leverage-yield API v2"). For the higher-level end-to-end vault-swap orchestrator use the `leverage-yield` skill instead. Skill links into the parent sodax-sdk knowledge tree.'
---

# Leverage Yield API (Core SDK granular skill)

Granular skill for `sodax.api.leverageYield` (class `LeverageYieldApiService`) — the typed HTTP client for
the backend **Leverage Yield API** (`/leverage-yield/*`). `sodax.api` is an alias for `sodax.backendApi`;
`.leverageYield` is the leverage-yield client. 33 endpoints, one method each; every method returns
`Promise<Result<T>>` (never throws) and validates the response. Errors carry `feature: 'backend'`,
`context.api: 'leverageYield'`, `context.endpoint`.

A leverage-yield deposit/withdraw **is** an intent-based swap (the vault's `lsoda*` share token is
solver-tradeable), so the intent-relay / gas / fee / submit-tx endpoints share the Swaps API wire shapes —
this is the leverage-yield sibling of the [`swaps-api`](../swaps-api/SKILL.md) skill.

> Lower-level than `sodax.leverageYield`: this is the raw backend HTTP surface. For the end-to-end
> build→relay→post-execution vault swap orchestrator, use the [`leverage-yield`](../leverage-yield/SKILL.md) skill.

## Step 1 — Clarify with user before coding

1. **Which endpoint(s)?** Vault registry · vault reads (asset/position/APR/effective-APR/LSD-APR/total-assets/
   previews/share-balance/max-withdraw) · deposit/withdraw quote · deadline · allowance/approve ·
   create-deposit-intent / create-withdraw-intent · intent lifecycle (submit/status/cancel/hash/packet/
   extra-data/fill/get) · gas/fees · submit-tx/status.
2. **Orchestrator or raw API?** If the user just wants "deposit into / withdraw from a leverage vault",
   prefer `sodax.leverageYield` (the `leverage-yield` skill). Use `sodax.api.leverageYield` when they need a
   single backend call (a vault APR, a position read, a deposit quote, a status poll) or are building their
   own flow.
3. **Deposit vs withdraw?** Create-intent is split: `createDepositIntent` (any token → `lsoda*`, needs a
   spoke allowance) vs `createWithdrawIntent` (`lsoda*` → any token, hub-wallet swap, no spoke allowance).

## Integration workflow

1. [`../integration/knowledge/ai-rules.md`](../integration/knowledge/ai-rules.md) — DO / DO NOT (read first).
2. [`../integration/knowledge/features/leverage-yield-api.md`](../integration/knowledge/features/leverage-yield-api.md) — the full 33-endpoint client: signatures, wire shapes (bigint vs decimal string), common call shapes (vault reads, deposit quote, create-intent, submit-tx + status), per-call overrides, custom endpoint, the `useBackendSubmitTx` service option.
3. For the end-to-end vault-swap flow that wraps these calls → [`../integration/knowledge/features/leverage-yield.md`](../integration/knowledge/features/leverage-yield.md); for the intent-sibling swaps client → [`../integration/knowledge/features/swaps-api.md`](../integration/knowledge/features/swaps-api.md).
4. Errors are `Result<T, SodaxError<'EXTERNAL_API_ERROR'>>` → [`../integration/knowledge/recipes/result-and-errors.md`](../integration/knowledge/recipes/result-and-errors.md) and [`../integration/knowledge/reference/error-codes.md`](../integration/knowledge/reference/error-codes.md).

### Leverage-Yield-API-specific anti-patterns

- **`try/catch` for failures.** Every method returns `Result<T>` — branch on `result.ok`. `catch` won't fire for HTTP/timeout/validation failures.
- **Passing the `RelayExtraData` object** to `submitTx`'s `relayData`. The field is a `string` — pass `relayData.payload`.
- **Omitting `operation` on `submitTx`.** `LeverageYieldSubmitTxRequestV2` is the swaps body PLUS a required `operation: 'deposit' | 'withdraw'` — the backend records the queued row from it.
- **Polling for `'executed'`.** A vault swap IS a solver swap, so terminal success is `'solved'` (`'executed'` is the *bridge* API's terminal state). A set `abandonedAt` is terminal too.
- **Broadcasting `approve`'s `tx` without its `resetTx`.** `ApproveResponseV2` is `{ tx, resetTx? }`; a guarded input token needs `resetTx` MINED first or the approve reverts. In `@sodax/dapp-kit`, prefer `useLeverageYieldApiApproveAndBroadcast`, which owns that ordering.
- **Stringifying `intent` numerics yourself.** `IntentRequestV2` fields are `bigint`; the client serializes them to decimal strings — pass the bigint intent through as-is.
- **Checking allowance for a withdraw.** `createWithdrawIntent` is a hub-wallet swap (spends `lsoda*` from the hub wallet) — there is no spoke allowance step. `checkAllowance`/`approve` take the **deposit** params only.
- **Calling `getSubmitTxStatus` with only `txHash`.** Both `txHash` AND `srcChainKey` are required.
- **Confusing `sodax.api.leverageYield` with `sodax.leverageYield`.** The former is the backend HTTP client; the latter is the on-chain vault-swap orchestrator.

## Migration workflow (v1 → v2)

The typed `sodax.api.leverageYield` client is **v2-new** — leverage yield itself has no v1 equivalent, so
there is nothing to port. The intent-relay / submit-tx request shapes it shares with swaps are covered in
the swap + backend-api migration docs if you need the deltas:

1. [`../migration-v1-to-v2/knowledge/features/swap.md`](../migration-v1-to-v2/knowledge/features/swap.md) — create-intent / submit-tx request-shape changes (`srcChainId` → `srcChainKey`, `relayData` object → string, bigint intent).
2. [`../migration-v1-to-v2/knowledge/features/backend-api.md`](../migration-v1-to-v2/knowledge/features/backend-api.md) — the `Result`-wrapping HTTP-client contract.

## Verification

1. `pnpm tsc --noEmit` clean.
2. Every `await sodax.api.leverageYield.<method>(...)` call site has `if (!result.ok)`.
3. `submitTx.relayData` is `relayData.payload` (string), `submitTx` carries `operation`, and `getSubmitTxStatus` passes both `txHash` and `srcChainKey`.
4. Submit-tx status polling stops on `'solved'` / `'failed'` / `abandonedAt` — not on `'executed'`.
5. Intent-bearing bodies pass the `bigint` `IntentRequestV2` through unmodified (no manual `.toString()`).
6. Allowance/approve are used only for the deposit path (withdraw is a hub-wallet swap), and a returned `resetTx` is broadcast and mined before `tx`.

## Related granular skills (same family)

- [`../leverage-yield/SKILL.md`](../leverage-yield/SKILL.md) — the end-to-end vault-swap orchestrator (`sodax.leverageYield`) that wraps these backend calls.
- [`../swaps-api/SKILL.md`](../swaps-api/SKILL.md) — the intent-sibling Swaps API client (`sodax.api.swaps`), same intent-relay/gas/fee/submit-tx wire shapes.
- [`../backend-api/SKILL.md`](../backend-api/SKILL.md) — the sibling `sodax.backendApi` read client (intent / orderbook / money-market reads + config).

For multi-feature tasks, load the broad [`sodax-sdk` skill](../SKILL.md).
