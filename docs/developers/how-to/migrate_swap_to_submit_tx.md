---
title: "Migrate a manual swap to submit-tx"
icon: rotate
generatedFrom: packages/sdk/docs/MIGRATE_SWAP_TO_SUBMIT_TX.md
---

`sodax.swaps.swap()` no longer runs a single linear pipeline. It creates the intent, then tries a
**backend submit-tx attempt**, and on any non-success **falls back** to the client-side relay so the
swap still completes.

If you drive the swap steps yourself — `createIntent`, then relay submission, then `postExecution` —
you get neither the backend path nor the fallback. This guide shows how to adopt both.

| Find an answer | Section |
| --- | --- |
| Do I need to change anything? | [Who needs this](#who-needs-this) |
| What actually changed | [What changed](#what-changed) |
| Shortest migration | [Option A — hand the whole flow to `swap()`](#option-a--hand-the-whole-flow-to-swap) |
| Keep driving the steps myself | [Option B — keep manual control](#option-b--keep-manual-control) |
| How long each phase may take | [Two budgets, never one](#two-budgets-never-one) |
| Is retrying safe? | [Why falling back is safe](#why-falling-back-is-safe) |
| What to do on each outcome | [Outcome → action](#outcome--action) |
| Reference for every method | [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) |

---

## Who needs this

**You can stop reading** if your code calls `sodax.swaps.swap()` or `sodax.swaps.createLimitOrder()`.
Both already run the backend attempt and the fallback for you, and the shape of `SwapResponse` is
unchanged.

**This guide is for you** if you call `createIntent` and then handle the relay and solver notification
yourself — a bot, a backend orchestrator, or a frontend that persists each step. That code still works,
but it now takes the slow path every time and misses the backend's server-side relay.

---

## What changed

`swap()` runs these phases:

1. **`createIntent`** — build, sign and broadcast the intent transaction on the source chain. Unchanged.
2. **Backend submit-tx attempt** — hand the broadcast transaction to `sodax.api.swaps.submitTx`. The
   backend verifies, relays and post-executes server-side; the SDK polls `getSubmitTxStatus` until the
   swap is `solved`. Controlled by `swaps.useBackendSubmitTx`, default `true`.
3. **Client-side fallback** — on *any* non-success in step 2: verify the transaction landed, relay it to
   the hub and wait for the packet, then call `postExecution`. This is the path your manual code
   already implements.

Step by step, against the flow you have today:

| Your manual step today | After |
| --- | --- |
| `createIntent` | Unchanged — still the source of `{ tx, intent, relayData }` |
| `submitIntent({ action: 'submit', params: { chain_id, tx_hash, data? } })` | Try `sodax.api.swaps.submitTx` first; relay submission becomes the fallback |
| Poll the relay yourself / `waitUntilIntentExecuted` | Poll `sodax.api.swaps.getSubmitTxStatus` to `solved` first; relay polling becomes the fallback |
| `postExecution({ intent_tx_hash })` | Done server-side on the backend path; still yours on the fallback |
| — | **New:** `verifyTxHash` before the fallback relay — and *not* before the backend submit |
| — | **New:** a second, fresh `timeout` for the fallback |
| Solver is the only status source | `getDetailedStatus` routes between the backend record and the solver |

> **The orchestration helpers are internal.** `SwapService.submitTx` and `SwapService.fallbackSwapSteps`
> are private, and the attempt budget and poll loop behind them are not exported from `@sodax/sdk`. The
> pieces they call — `sodax.api.swaps.submitTx`, `getSubmitTxStatus`, `relayTxAndWaitPacket`,
> `postExecution` — are public, so [Option B](#option-b--keep-manual-control) rebuilds the loop in your
> own code rather than importing it.

---

## Option A — hand the whole flow to `swap()`

The shortest migration, and the one to prefer unless you have a concrete reason to own the steps.
Delete the manual relay and post-execution code and call `swap()`:

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { IEvmWalletProvider, SwapResponse } from '@sodax/sdk';

declare const sodax: Sodax;
declare const evmWalletProvider: IEvmWalletProvider;
declare const createIntentParams: Parameters<typeof sodax.swaps.swap>[0]['params'];

const swapResult = await sodax.swaps.swap({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
  timeout: 120_000, // optional — a PER-ATTEMPT budget, see below
});

if (!swapResult.ok) {
  // Both paths failed. Branch on swapResult.error.code — see SWAPS.md § Error Handling.
  return;
}

const { solverExecutionResponse, intent, intentDeliveryInfo }: SwapResponse = swapResult.value;
```

To keep exactly the old behaviour — client-side relay only, no backend attempt — opt out at construction:

```typescript
const sodaxClientSideOnly = new Sodax({ swaps: { useBackendSubmitTx: false } });
```

That flag is a client-side runtime option, not part of the backend-fetched config. See
[CONFIGURE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#backend-submit-tx-2-step-swapsusebackendsubmittx).

---

## Option B — keep manual control

Use this when you must own the steps: a bot that persists every transition, a backend with its own
signing boundary, or a UI that reports each phase. You reimplement what `swap()` does internally.

### Step 1 — create the intent

Unchanged. Keep all three returned values — the submit-tx request needs each of them.

The bindings below are shared by every step in this section:

```typescript
import type { IEvmWalletProvider, SpokeChainKey } from '@sodax/sdk';

declare const evmWalletProvider: IEvmWalletProvider;
declare const srcChainKey: SpokeChainKey; // === createIntentParams.srcChainKey
declare const timeoutMs: number;          // your per-attempt budget, e.g. DEFAULT_RELAY_TX_TIMEOUT
```

```typescript
const created = await sodax.swaps.createIntent({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});
if (!created.ok) return created;

const { tx: spokeTxHash, intent, relayData } = created.value;
```

### Step 2 — build the submit-tx request

```typescript
import type { SubmitTxRequestV2 } from '@sodax/sdk';

const request: SubmitTxRequestV2 = {
  txHash: spokeTxHash as string,
  srcChainKey: createIntentParams.srcChainKey,
  walletAddress: createIntentParams.srcAddress,
  intent,                       // straight from createIntent
  relayData: relayData.payload, // the hex STRING, not the { address, payload } object
};
```

Two fields are easy to get wrong: `relayData` is `relayData.payload`, and `walletAddress` is the
**source** address that signed the intent, not the destination.

**Persist `request` before you submit it.** If the process dies after broadcasting, this record is what
lets you resume; re-submitting the same `(txHash, srcChainKey)` is idempotent and answers
`data.status: 'duplicate'`. Never sign a second deposit to recover.

`request.intent` carries `bigint` fields (`intentId`, `inputAmount`, `minOutputAmount`, `deadline`,
`srcChain`, `dstChain`), so a plain `JSON.stringify(request)` **throws** — in the exact crash window
this step exists to survive. Serialize them explicitly and restore them on the way back in:

```typescript
const serialized = JSON.stringify(request, (_key, value) =>
  typeof value === 'bigint' ? value.toString() : value,
);

// On resume, parse back and coerce the bigint fields before reusing the request.
```

The SDK's own wire client does the same thing internally, which is why passing `intent` straight to
`submitTx` needs no conversion from you — only your own storage does.

### Step 3 — open the attempt budget, then submit

The attempt starts **before** the POST, not after it: the submit request draws on the same budget as
the poll, so a stalled POST costs the attempt rather than silently extending it. Every backend request
is capped at the budget left, but never above the API service's own timeout.

```typescript
const serviceTimeoutMs = sodax.api.swaps.getTimeout();
const attemptDeadline = Date.now() + timeoutMs;

const remaining = (): number => Math.max(0, attemptDeadline - Date.now());
// `null` means no request should go out at all — fall back rather than arm an abort at 0 ms.
const requestTimeout = (): number | null => {
  const capped = Math.min(remaining(), serviceTimeoutMs);
  return capped > 0 ? capped : null;
};

const submitBudget = requestTimeout();
if (submitBudget === null) return fallbackSwapSteps(); // Step 5

const submitted = await sodax.api.swaps.submitTx(request, { timeout: submitBudget });

if (!submitted.ok) {
  // Transport / HTTP / validation failure — `submitted.error.code` is 'EXTERNAL_API_ERROR'
  // with `context.api: 'swaps'`.
  return fallbackSwapSteps();
}
if (!submitted.value.success) {
  // A 200 can still report the submission was not queued. There is nothing to poll for, and the
  // reason is on the payload, not on an error: `submitted.value.data.message`.
  return fallbackSwapSteps();
}
```

Do **not** call `verifyTxHash` before this. The backend runs its own verification, so waiting for a
client-side confirmation delays every backend success by the source chain's confirmation time and can
fail a swap the backend would have completed. Verification belongs to the fallback only.

### Step 4 — poll until `solved`

Same budget, same cap on every request — and no sleep that the attempt cannot outlast, since that
would be dead wait standing between you and the fallback.

```typescript
import { isAuthFailure } from '@sodax/sdk';
import type { Result, SubmitTxStatusQueryV2, SwapResponse } from '@sodax/sdk';

const query: SubmitTxStatusQueryV2 = { txHash: spokeTxHash as string, srcChainKey };
const intervalMs = 1_000;

for (let budget = requestTimeout(); budget !== null; budget = requestTimeout()) {
  const snapshot = await sodax.api.swaps.getSubmitTxStatus(query, { timeout: budget });

  if (snapshot.ok) {
    const { status, result, abandonedAt } = snapshot.value.data;

    // Terminal success needs BOTH fields — without them there is no SwapResponse to build.
    if (status === 'solved' && result?.dstIntentTxHash && result.intent_hash) {
      const value: SwapResponse = {
        solverExecutionResponse: { answer: 'OK', intent_hash: result.intent_hash as `0x${string}` },
        intent,
        intentDeliveryInfo: {
          srcChainKey,
          srcTxHash: spokeTxHash as string,
          srcAddress: createIntentParams.srcAddress,
          dstChainKey: createIntentParams.dstChainKey,
          dstTxHash: result.dstIntentTxHash,
          dstAddress: createIntentParams.dstAddress,
        },
      };
      return { ok: true, value } satisfies Result<SwapResponse>;
    }
    // Terminal failure: the backend is done and will not finish this swap.
    if (status === 'failed' || abandonedAt) break;
    // pending | relaying | relayed | posting_execution | posted_execution → keep going.
  } else if (isAuthFailure(snapshot.error)) {
    // A rejected API key cannot become success by waiting. Stop instead of burning the
    // budget the fallback is waiting on. Other transport failures are worth retrying.
    break;
  }

  // Give up rather than sleep past the attempt — that wait only delays the fallback.
  if (remaining() <= intervalMs) break;
  await new Promise(resolve => setTimeout(resolve, intervalMs));
}

return fallbackSwapSteps(); // Step 5 — every exit above is a non-success
```

Every way out of that loop other than `solved` means "the backend did not finish it" — fall back.

### Step 5 — fall back to the client-side relay

This is the flow you already have, with two additions: the relay gets its **own** fresh timeout, and it
returns the **same** `SwapResponse` the backend path does — so callers handle completion through one
contract no matter which path ran, exactly as `swap()` does.

```typescript
import { relayTxAndWaitPacket, RELAY_FALLBACK_FLOOR_MS, isHubChainKeyType } from '@sodax/sdk';
import type { Result, SwapResponse } from '@sodax/sdk';

async function fallbackSwapSteps(): Promise<Result<SwapResponse>> {
  const verified = await sodax.spoke.verifyTxHash({ txHash: spokeTxHash as string, chainKey: srcChainKey });
  if (!verified.ok) return verified;

  let hubTxHash: string;
  if (isHubChainKeyType(srcChainKey)) {
    // Source IS the hub — the spoke tx already is the hub tx, so there is nothing to relay.
    hubTxHash = spokeTxHash as string;
  } else {
    const packet = await relayTxAndWaitPacket({
      srcTxHash: spokeTxHash as string,
      data: relayData,                 // the { address, payload } object here, not the string
      chainKey: srcChainKey,
      relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
      // A FRESH budget, floored so a small caller timeout cannot strand an already-landed tx.
      timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),
    });
    if (!packet.ok) return packet;
    hubTxHash = packet.value.dst_tx_hash;
  }

  const posted = await sodax.swaps.postExecution({ intent_tx_hash: hubTxHash as `0x${string}` });
  if (!posted.ok) return posted;

  // Same shape Step 4 returns on the backend path.
  return {
    ok: true,
    value: {
      solverExecutionResponse: posted.value,
      intent,
      intentDeliveryInfo: {
        srcChainKey,
        srcTxHash: spokeTxHash as string,
        srcAddress: createIntentParams.srcAddress,
        dstChainKey: createIntentParams.dstChainKey,
        dstTxHash: hubTxHash,
        dstAddress: createIntentParams.dstAddress,
      },
    },
  };
}
```

Note `data: relayData` here takes the whole `RelayExtraData` object, while the submit-tx request in
Step 2 takes `relayData.payload`.

---

## Two budgets, never one

`timeout` is a **per-attempt** budget, not an end-to-end deadline. The backend attempt gets one; if it
does not complete, the fallback relay gets a fresh one. Give your manual flow the same shape — a single
shared deadline leaves the fallback only what the backend did not spend, which is how a relay that needs
longer than the leftovers ends in a timeout.

Phases bounded by different things:

| Phase | Bound |
| --- | --- |
| `createIntent` — build, sign, broadcast | **not** bounded by `timeout` |
| Backend attempt — submit POST + status poll | `timeout` |
| ↳ any single backend request within it | `min(budget left in the attempt, api.timeout)` |
| On-chain verification — fallback only | the source chain's `pollingConfig.maxTimeoutMs` |
| Relay wait — fallback only, starts after verification | `max(timeout, RELAY_FALLBACK_FLOOR_MS)` |
| `postExecution` — fallback only | **not** bounded by `timeout` |

Read the constants from source rather than memorising them:
`DEFAULT_RELAY_TX_TIMEOUT`, `DEFAULT_BACKEND_API_TIMEOUT` and per-chain `pollingConfig` live in
[`@sodax/types`](https://github.com/icon-project/sodax-sdks/tree/main/packages/types/src);
`RELAY_FALLBACK_FLOOR_MS` lives in
[`IntentRelayApiService.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/shared/services/intentRelay/IntentRelayApiService.ts).
The full breakdown is in
[SWAPS.md § How `timeout` bounds each attempt](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md#how-timeout-bounds-each-attempt).

---

## Why falling back is safe

Re-relaying and re-posting an already-processed swap is **idempotent**: the relay deduplicates and
returns the existing `executed` packet, and the solver re-affirms the intent rather than filling it
twice. This is covered by the SDK's live relay end-to-end test.

The fallback is also load-bearing rather than belt-and-braces. The backend keeps processing at its own
pace after your poll gives up, so your fallback relay may race the backend's — and that is fine, for the
same reason.

---

## Outcome → action

| Backend outcome | What it means | Do |
| --- | --- | --- |
| `submitTx` returns `!ok` | Transport, HTTP or validation failure | Fall back |
| `submitTx` returns `success: false` | 200, but the submission was not queued | Fall back — there is nothing to poll for |
| `status: 'solved'` with `dstIntentTxHash` + `intent_hash` | Done, server-side | Return the result |
| `status: 'solved'` missing either field | Not complete yet | Keep polling |
| `status: 'failed'`, or `abandonedAt` set | Terminal; the backend will not finish it | Fall back |
| `pending` / `relaying` / `relayed` / `posting_execution` / `posted_execution` | In flight | Keep polling |
| Status request rejects the API key (401/403) | Cannot become success by waiting | Stop polling, fall back |
| Poll budget exhausted | Backend never finished in time | Fall back |

---

## Chain-specific notes

- **Solana and Bitcoin** deposits commit only a *hash* of the relay payload on-chain, so the relayer can
  correlate a submission only with the exact original bytes. Keep the `relayData` that `createIntent`
  returned. If it is gone, recover byte-identical data with
  `sodax.swaps.getIntentSubmitTxExtraData({ txHash })` — note that `txHash` there is the **hub-chain**
  transaction hash, not the source-chain `spokeTxHash` used everywhere else in this guide, because the
  lookup reads the intent off the hub. From a populated `Intent` you already hold,
  `sodax.swaps.reconstructRelayData(intent)` derives the same bytes offline with no RPC call.
- **Sonic as the source chain** has no relay leg — the spoke transaction already is the hub transaction.
  The fallback must skip the relay and go straight to `postExecution`.
- **Stellar destinations** still need a trustline before the swap; see
  [STELLAR_TRUSTLINE.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/STELLAR_TRUSTLINE.md).

---

## Status and recovery

Once a swap is in flight, read its state from the **source-chain** transaction hash:

```typescript
const detailed = await sodax.swaps.getDetailedStatus({ srcChainKey, srcTxHash: spokeTxHash as string });

if (detailed.ok) {
  if (detailed.value.source === 'backend') {
    // detailed.value.data is the backend submit-tx record
  } else {
    // detailed.value.source === 'solver' — data is the solver status, dstTxHash is the hub tx
  }
}
```

`getDetailedStatus` routes to the backend record or the solver, whichever can answer, which replaces
hand-rolled "try the backend, then try the solver" logic. `getStatus` and `getSolvedIntentPacket` are
unchanged.

---

## Checklist

- [ ] Decided between [Option A](#option-a--hand-the-whole-flow-to-swap) and [Option B](#option-b--keep-manual-control)
- [ ] Submit-tx request built with `relayData.payload` and the **source** wallet address
- [ ] The request is persisted **before** `submitTx` is called
- [ ] Both `result.ok` and `result.value.success` are checked
- [ ] Poll treats only `solved` (with both result fields) as success
- [ ] Poll bails on `failed` / `abandonedAt` and on 401/403
- [ ] Every non-success path reaches the fallback
- [ ] No `verifyTxHash` before the backend submit — only in the fallback
- [ ] The fallback relay gets its own fresh timeout, floored at `RELAY_FALLBACK_FLOOR_MS`
- [ ] Hub-source swaps skip the relay leg
- [ ] Solana/Bitcoin keep or recover the exact `relayData` bytes

---

## See also

- [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) — full `SwapService` reference, including § Backend 2-step submit and § Error Handling
- [HOW_TO_MAKE_A_SWAP.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/HOW_TO_MAKE_A_SWAP.md) — end-to-end walkthrough of a first swap
- [CONFIGURE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#backend-submit-tx-2-step-swapsusebackendsubmittx) — `useBackendSubmitTx`, API keys and timeouts
- [INTENT_RELAY_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/INTENT_RELAY_API.md) — the relay layer the fallback uses
