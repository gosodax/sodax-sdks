# Manual submit-tx with client-side fallback

`sodax.swaps.swap()` already does this internally: it creates the intent, tries the backend submit-tx path, and on **any** non-success falls back to the client-side relay. Prefer `swap()` unless the consumer must own each step (a bot that persists every transition, a backend with its own signing boundary, a UI that reports phases).

When they do own the steps, reproduce **both** paths. The orchestration helpers behind `swap()` are package-internal — `SwapService.submitTx` and `SwapService.fallbackSwapSteps` are private, and the attempt budget and poll loop are not exported — so the loop is hand-written from the public pieces below.

Bindings shared by every step below:

```ts
import type { IEvmWalletProvider, SpokeChainKey } from '@sodax/sdk';

declare const evmWallet: IEvmWalletProvider;
declare const srcChainKey: SpokeChainKey;   // === params.srcChainKey
declare const timeoutMs: number;            // per-attempt budget, e.g. DEFAULT_RELAY_TX_TIMEOUT
```

## 1. Create the intent, keep all three values

```ts
const created = await sodax.swaps.createIntent({ params, walletProvider: evmWallet });
if (!created.ok) return created;

const { tx: spokeTxHash, intent, relayData } = created.value;
```

## 2. Build the request

```ts
import type { SubmitTxRequestV2 } from '@sodax/sdk';

const request: SubmitTxRequestV2 = {
  txHash: spokeTxHash as string,
  srcChainKey: params.srcChainKey,
  walletAddress: params.srcAddress,   // the SOURCE address that signed, not the destination
  intent,                             // passes straight through from createIntent
  relayData: relayData.payload,       // the hex STRING, not the { address, payload } object
};
```

Persist `request` **before** submitting. Re-submitting the same `(txHash, srcChainKey)` is idempotent (`data.status: 'duplicate'`); never sign a second deposit to recover.

`request.intent` carries `bigint` fields (`intentId`, `inputAmount`, `minOutputAmount`, `deadline`, `srcChain`, `dstChain`), so plain `JSON.stringify(request)` THROWS — in the exact crash window this step exists to survive. Serialize them, and coerce them back on resume:

```ts
const serialized = JSON.stringify(request, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
```

Passing `intent` straight to `submitTx` still needs no conversion — the wire client serializes internally. Only your own storage does.

## 3. Open the attempt budget, then submit

The attempt starts **before** the POST — the submit draws on the same budget as the poll, so a stalled POST costs the attempt instead of silently extending it. Cap every request at the budget left, never above the service's own timeout.

```ts
const serviceTimeoutMs = sodax.api.swaps.getTimeout();
const attemptDeadline = Date.now() + timeoutMs;

const remaining = () => Math.max(0, attemptDeadline - Date.now());
const requestTimeout = (): number | null => {
  const capped = Math.min(remaining(), serviceTimeoutMs);
  return capped > 0 ? capped : null;   // null → issue no request at all
};

const submitBudget = requestTimeout();
if (submitBudget === null) return fallback();

const submitted = await sodax.api.swaps.submitTx(request, { timeout: submitBudget });

// Two distinct arms — the reason lives in a different place on each.
if (!submitted.ok) return fallback();              // transport: submitted.error.code
if (!submitted.value.success) return fallback();   // 200 not queued: submitted.value.data.message
```

Do **not** call `verifyTxHash` before this. The backend verifies itself, so a client-side confirmation wait only delays every backend success. Verification belongs to the fallback.

## 4. Poll until `solved`

Same budget, same cap per request, and no sleep the attempt cannot outlast — that wait only delays the fallback.

```ts
import { isAuthFailure } from '@sodax/sdk';
import type { Result, SubmitTxStatusQueryV2, SwapResponse } from '@sodax/sdk';

const query: SubmitTxStatusQueryV2 = { txHash: spokeTxHash as string, srcChainKey };
const intervalMs = 1_000;

for (let budget = requestTimeout(); budget !== null; budget = requestTimeout()) {
  const snapshot = await sodax.api.swaps.getSubmitTxStatus(query, { timeout: budget });

  if (snapshot.ok) {
    const { status, result, abandonedAt } = snapshot.value.data;
    // Terminal success needs BOTH fields.
    if (status === 'solved' && result?.dstIntentTxHash && result.intent_hash) {
      const value: SwapResponse = {
        solverExecutionResponse: { answer: 'OK', intent_hash: result.intent_hash as `0x${string}` },
        intent,
        intentDeliveryInfo: {
          srcChainKey,
          srcTxHash: spokeTxHash as string,
          srcAddress: params.srcAddress,
          dstChainKey: params.dstChainKey,
          dstTxHash: result.dstIntentTxHash,
          dstAddress: params.dstAddress,
        },
      };
      return { ok: true, value } satisfies Result<SwapResponse>;
    }
    if (status === 'failed' || abandonedAt) break;          // terminal failure
    // pending | relaying | relayed | posting_execution | posted_execution → keep polling
  } else if (isAuthFailure(snapshot.error)) {
    break;   // a rejected API key cannot become success by waiting
  }

  if (remaining() <= intervalMs) break;
  await new Promise(r => setTimeout(r, intervalMs));
}

return fallback();   // every exit other than `solved` is a non-success
```

## 5. Fallback — the client-side relay

Returns the **same** `SwapResponse` as the backend path, so callers handle completion through one contract whichever path ran — as `swap()` does.

```ts
import { relayTxAndWaitPacket, RELAY_FALLBACK_FLOOR_MS, isHubChainKeyType } from '@sodax/sdk';
import type { Result, SwapResponse } from '@sodax/sdk';

async function fallback(): Promise<Result<SwapResponse>> {
  const verified = await sodax.spoke.verifyTxHash({ txHash: spokeTxHash as string, chainKey: srcChainKey });
  if (!verified.ok) return verified;

  let hubTxHash: string;
  if (isHubChainKeyType(srcChainKey)) {
    hubTxHash = spokeTxHash as string;    // source IS the hub — nothing to relay
  } else {
    const packet = await relayTxAndWaitPacket({
      srcTxHash: spokeTxHash as string,
      data: relayData,                     // the OBJECT here, not the payload string
      chainKey: srcChainKey,
      relayerApiEndpoint: sodax.swaps.relayerApiEndpoint,
      timeout: Math.max(timeoutMs, RELAY_FALLBACK_FLOOR_MS),   // a FRESH budget
    });
    if (!packet.ok) return packet;
    hubTxHash = packet.value.dst_tx_hash;
  }

  const posted = await sodax.swaps.postExecution({ intent_tx_hash: hubTxHash as `0x${string}` });
  if (!posted.ok) return posted;

  return {
    ok: true,
    value: {
      solverExecutionResponse: posted.value,
      intent,
      intentDeliveryInfo: {
        srcChainKey,
        srcTxHash: spokeTxHash as string,
        srcAddress: params.srcAddress,
        dstChainKey: params.dstChainKey,
        dstTxHash: hubTxHash,
        dstAddress: params.dstAddress,
      },
    },
  };
}
```

## Rules

- **Two budgets, never one.** The backend attempt gets a timeout; the fallback relay gets a *fresh* one. A single shared deadline leaves the fallback only what the backend did not spend — that is how a relay that needs longer ends in a timeout.
- **Falling back is safe.** Re-relaying and re-posting an already-processed swap is idempotent: the relay deduplicates and returns the existing `executed` packet, and the solver re-affirms the intent rather than filling twice. It is also load-bearing — the backend keeps processing after the poll gives up, so the two relays can race.
- **Solana / Bitcoin need the exact `relayData` bytes** — those deposits commit only a hash of the payload on-chain. If the runtime value is gone, recover it with `sodax.swaps.getIntentSubmitTxExtraData({ txHash })`, where `txHash` is the **hub-chain** tx hash (it reads the intent off the hub) — not the source-chain `spokeTxHash` used elsewhere here. From an `Intent` you already hold, `sodax.swaps.reconstructRelayData(intent)` derives the same bytes offline.
- **Read status with `getDetailedStatus`**, which routes between the backend record and the solver — do not hand-roll that fallback too.
- Opting out entirely is a config flag, not hand-written code: `new Sodax({ swaps: { useBackendSubmitTx: false } })` makes `swap()` take the client-side path only.

---

## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../features/swap.md`](../features/swap.md) — `SwapService` surface, action params, error codes.
- [`result-and-errors.md`](result-and-errors.md) — branching on `result.ok` and `(feature, code)`.
- [`backend-server-init.md`](backend-server-init.md) — bot / partner-backend setup around this flow.
