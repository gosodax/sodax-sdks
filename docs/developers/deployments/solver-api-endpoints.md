---
title: "Solver API endpoints"
icon: handshake
generatedFrom: packages/sdk/docs/SOLVER_API_ENDPOINTS.md
---

> **Error handling conventions:** Direct callers of `SolverApiService` (used by lower-level scripts and tests) still receive `SolverErrorResponse` with `detail.code` / `detail.message`. The **swap module's** `postExecution` wraps these into `SodaxError` with code `EXTERNAL_API_ERROR`; the original `SolverIntentErrorCode` is on `result.error.context.solverCode` and the full `detail` is on `result.error.context.solverDetail` — see [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) Error Handling.

## Mainnet production

URL: [https://api.sodax.com/v1/intent](https://api.sodax.com/v1/intent)

This is the only solver host integrators should target. It is the packaged default, so no
configuration is needed unless you are deliberately overriding the endpoint.

---

## Overview

The solver API drives the intent-based swap feature. `SwapService` (accessed via `sodax.swaps`) is the public entry point — it delegates all HTTP communication to the stateless `SolverApiService` class. External callers should use `SwapService` rather than calling `SolverApiService` directly.

Three endpoints are exposed:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/quote` | `POST` | Get a price quote for a token pair and amount |
| `/execute` | `POST` | Notify the solver that an intent is live on the hub chain |
| `/status` | `POST` | Poll the execution status of a submitted intent |

All three carry the configured backend API key as the `x-api-key` header when `new Sodax({ apiKey })` is set — the same instance-wide key every other backend service uses. This is a config-level tier only: these requests take no per-call override. Solver auth failures come back through the `SolverErrorResponse` contract below rather than as an `EXTERNAL_API_ERROR`. See [CONFIGURE_SDK.md § API key](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#api-key). `solverApiEndpoint` is not derived from `api.baseURL`, so a browser app that proxies its backend traffic must repoint it too — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

---

## Error handling

All three solver methods return `Promise<Result<T, SolverErrorResponse>>`. On HTTP errors or network failures, `result.ok` is `false` and `result.error` is a `SolverErrorResponse`:

```ts
type SolverErrorResponse = {
  detail: {
    code: SolverIntentErrorCode;
    message: string;
  };
};
```

`SolverIntentErrorCode` is an enum defined in `@sodax/sdk`. On unhandled exceptions the code is `SolverIntentErrorCode.UNKNOWN`.

To branch on solver errors, inspect `result.error.detail.code`:

```ts
import { SolverIntentErrorCode } from '@sodax/sdk';

const quoteResult = await sodax.swaps.getQuote(payload);
if (!quoteResult.ok) {
  if (quoteResult.error.detail.code === SolverIntentErrorCode.UNKNOWN) {
    // network / unexpected failure
  }
}
```

---

## `POST /quote` — Get a price quote

Called via `SwapService.getQuote(payload)`.

### Request (`SolverIntentQuoteRequest`)

| Field | Type | Description |
|-------|------|-------------|
| `token_src` | `string` | Source token address on its spoke chain |
| `token_dst` | `string` | Destination token address on its spoke chain |
| `token_src_blockchain_id` | `string` | Source spoke chain relay ID (e.g. `'0x38.bsc'`) |
| `token_dst_blockchain_id` | `string` | Destination spoke chain relay ID (e.g. `'0xa4b1.arbitrum'`) |
| `amount` | `bigint` | Input amount in the source token's smallest unit |
| `quote_type` | `string` | Always `'exact_input'` — the only value the API accepts |

`SwapService.getQuote` automatically adjusts `amount` by the configured partner fee before forwarding to the solver, so the returned `quoted_amount` reflects the net output the user receives.

Token addresses are validated against the active `ConfigService` and translated to their hub (Sonic) equivalents before the request is sent.

### Response (`SolverIntentQuoteResponse`)

```ts
{ quoted_amount: bigint }
```

`quoted_amount` is in the destination token's smallest unit.

### Example

```ts
import { ChainKeys } from '@sodax/sdk';

const quoteResult = await sodax.swaps.getQuote({
  token_src: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  token_dst: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  token_src_blockchain_id: '0x38.bsc',
  token_dst_blockchain_id: '0xa4b1.arbitrum',
  amount: 1_000_000_000_000_000n,
  quote_type: 'exact_input',
});

if (quoteResult.ok) {
  console.log('Quoted amount:', quoteResult.value.quoted_amount);
}
```

---

## `POST /execute` — Notify solver of a live intent

Called via `SwapService.postExecution(request)`. Invoked automatically by `SwapService.swap()` after the relay packet lands on the hub — call this manually only when orchestrating swap steps yourself.

### Request (`SolverExecutionRequest`)

| Field | Type | Description |
|-------|------|-------------|
| `intent_tx_hash` | `Hex` | Hub-chain (Sonic) transaction hash where the intent was registered |

The request is retried automatically on transient network failures.

### Response (`SolverExecutionResponse`)

```ts
{ answer: 'OK'; intent_hash: Hex }
```

### Example

```ts
const execResult = await sodax.swaps.postExecution({
  intent_tx_hash: '0xabc123…',
});

if (execResult.ok) {
  console.log('Intent hash:', execResult.value.intent_hash);
}
```

---

## `POST /status` — Poll intent execution status

Called via `SwapService.getStatus(request)`.

### Request (`SolverIntentStatusRequest`)

| Field | Type | Description |
|-------|------|-------------|
| `intent_tx_hash` | `Hex` | Hub-chain (Sonic) tx hash of the intent. This is the `dst_tx_hash` from the relay packet returned by `swap()` or `relayTxAndWaitPacket`. |

### Response (`SolverIntentStatusResponse`)

| Field | Type | Description |
|-------|------|-------------|
| `status` | `SolverIntentStatusCode` | Numeric status code (see below) |
| `fill_tx_hash` | `string \| undefined` | Solver's fill tx hash — present only when `status === SolverIntentStatusCode.SOLVED (3)` |

`SolverIntentStatusCode` is an enum in `@sodax/sdk`. The value `3` (`SOLVED`) indicates the solver has filled the intent.

When the solver returns `NOT_FOUND` or the request fails, `sodax.swaps.getStatus` checks the backend's durable intent
record: if a fill that **consumed the whole input** was recorded there (`intentState.remainingInput === '0'`) it returns
`SOLVED` with that hub-chain fill hash.

What happens otherwise depends on whether that check could be made. A record showing no such fill — or a 404, the
backend saying it holds none — answers the question, so the solver's result is returned unchanged. If the record could
not be read at all (5xx, transport failure, unusable body), a solver `NOT_FOUND` is reported as a failed `Result`
instead: the fill may exist and simply be unreadable, so returning `NOT_FOUND` would present an unverified miss as a
definitive one. A poller that stops after N consecutive `NOT_FOUND` reads would otherwise spend that budget during a
backend outage and give up on a swap that had in fact completed. A failed solver request is returned as-is, since its
own error is the more useful diagnostic. An intent created with
`allowPartialFill` emits a fill event per fill, so a partial fill is deliberately **not** reported as `SOLVED` — that
would mark an unfinished swap complete and stop `useStatus` from polling it. The static `SolverApiService.getStatus`
does not do any of this.

`SolverApiService.getStatus(request, config, logger?, timeoutMs?)` takes an optional request budget. Omit it and the
call is unbounded, as it has always been; supply it when a stalled solver must not hold the caller open. An expiry is
reported as `UNKNOWN`, like any other failure. `sodax.swaps.getStatus` leaves it unset — a one-shot read is the
caller's to bound — while `getDetailedStatus`, which is meant to be polled, sets it.

### Example

```ts
import { SolverIntentStatusCode } from '@sodax/sdk';

const statusResult = await sodax.swaps.getStatus({
  intent_tx_hash: '0xabc123…',
});

if (statusResult.ok && statusResult.value.status === SolverIntentStatusCode.SOLVED) {
  const fillTxHash = statusResult.value.fill_tx_hash;
  // use getSolvedIntentPacket to wait for delivery on the destination chain
  const packetResult = await sodax.swaps.getSolvedIntentPacket({
    chainId: ChainKeys.ARBITRUM_MAINNET,
    fillTxHash,
  });
}
```

---

## Full swap flow

`SwapService.swap()` orchestrates the complete lifecycle. The steps below show what happens internally and where each solver endpoint is called:

```
1. createIntent()         → spoke chain tx (deposit / send message)
2. verifyTxHash()         → confirm spoke tx is on-chain
3. relayTxAndWaitPacket() → relay spoke tx to hub (skipped when srcChainKey is the hub)
4. postExecution()        → POST /execute  (notify solver; uses hub dst_tx_hash)
```

Polling intent status and waiting for fill delivery are separate steps the caller performs after `swap()` returns:

```
5. getStatus()            → POST /status  (poll until SOLVED)
6. getSolvedIntentPacket()→ wait for fill relay packet on destination chain
```

### Complete example

```ts
import { ChainKeys, SolverIntentStatusCode } from '@sodax/sdk';

// 1. Execute the swap (steps 1–4 above)
const deadline = await sodax.swaps.getSwapDeadline();
if (!deadline.ok) {
  console.error(deadline.error);
  return;
}

const swapResult = await sodax.swaps.swap({
  params: {
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    outputToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    inputAmount: 1_000_000_000_000_000n,
    minOutputAmount: 900_000_000_000_000n,
    srcAddress: '0xYourAddress',
    dstAddress: '0xYourAddress',
    deadline: deadline.value,
    allowPartialFill: false,
  },
  walletProvider: evmWalletProvider,  // IEvmWalletProvider — narrows from srcChainKey
});

if (!swapResult.ok) {
  // Branch on result.error.code, never on the message. swap() returns one of:
  //   USER_REJECTED | VALIDATION_FAILED | INTENT_CREATION_FAILED | TX_VERIFICATION_FAILED
  //   TX_SUBMIT_FAILED | RELAY_TIMEOUT | RELAY_FAILED | EXECUTION_FAILED
  //   EXTERNAL_API_ERROR | UNKNOWN
  // result.error.cause holds the underlying error
  console.error(swapResult.error.code, swapResult.error);
  return;
}

const { intentDeliveryInfo } = swapResult.value;

// 2. Poll until the solver fills the intent (step 5)
let fillTxHash: string | undefined;
while (!fillTxHash) {
  const statusResult = await sodax.swaps.getStatus({
    intent_tx_hash: intentDeliveryInfo.dstTxHash as `0x${string}`,
  });
  if (statusResult.ok && statusResult.value.status === SolverIntentStatusCode.SOLVED) {
    fillTxHash = statusResult.value.fill_tx_hash;
  } else {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// 3. Wait for the fill to land on the destination chain (step 6)
const packetResult = await sodax.swaps.getSolvedIntentPacket({
  chainId: ChainKeys.ARBITRUM_MAINNET,
  fillTxHash,
});

if (packetResult.ok) {
  console.log('Destination tx:', packetResult.value.dst_tx_hash);
}
```

---

## Chain keys

Use `ChainKeys.*` from `@sodax/sdk` for all chain references. `SpokeChainKey` is the union of `ChainKeys` values. `XToken.chainKey` (not `xChainId`) carries the chain key on token objects.

```ts
import { ChainKeys } from '@sodax/sdk';

ChainKeys.SONIC_MAINNET       // hub chain
ChainKeys.ARBITRUM_MAINNET
ChainKeys.BSC_MAINNET
// … see CHAIN_ID_MIGRATION.md for full mapping from old *_CHAIN_ID constants
```

`Intent.srcChain` and `Intent.dstChain` are `bigint` relay chain IDs (not chain keys) — use `getIntentRelayChainId(chainKey)` from `@sodax/sdk` to convert between them.

---

## Related source files

- `packages/sdk/src/swap/SolverApiService.ts` — stateless HTTP client for the three solver endpoints
- `packages/sdk/src/swap/SwapService.ts` — public service facade; use `sodax.swaps`
- `packages/sdk/src/swap/EvmSolverService.ts` — EVM-level intent ABI encoding/decoding and event parsing
- `packages/sdk/docs/SWAPS.md` — full swap feature documentation
- `packages/sdk/docs/ARCHITECTURE_REFACTOR_SUMMARY.md` — v2 architecture reference (chain keys, `Result<T>`, error convention)
- `packages/sdk/CHAIN_ID_MIGRATION.md` — mapping from old `*_CHAIN_ID` constants to `ChainKeys.*`
