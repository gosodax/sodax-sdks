---
title: "Swaps"
icon: rotate
generatedFrom: packages/sdk/docs/SWAPS.md
---

The swap module provides abstractions for interacting with cross-chain Intent Smart Contracts, the solver API, and the Relay API.

All swap operations are accessed through the `swaps` property of a `Sodax` instance:

```typescript
import { Sodax } from '@sodax/sdk';

const sodax = new Sodax();

// All swap methods are available through sodax.swaps
const quote = await sodax.swaps.getQuote(quoteRequest);
```

> **`sodax.swaps` vs `sodax.api.swaps`.** This page documents `sodax.swaps` (`SwapService`) — the end-to-end intent orchestrator that creates, relays, and finalizes swaps on-chain. The lower-level typed HTTP client for the backend Swaps API (quote, create-intent, submit-tx, status, fees — 21 endpoints) is `sodax.api.swaps` (`SwapsApiService`); see [`SWAPS_API.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS_API.md).

## Using SDK Config and Constants

The SDK includes predefined configurations of supported chains, tokens, and other relevant information.
All configurations are reachable through the `config` property of the `Sodax` instance.

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { SpokeChainKey, XToken } from '@sodax/sdk';

const sodax = new Sodax();

// The current SDK keeps packaged defaults merged with constructor overrides.
await sodax.initialize();

// All supported spoke chain keys
const spokeChains: SpokeChainKey[] = sodax.config.getSupportedSpokeChains();

// Supported swap tokens for a specific spoke chain key
const supportedTokens: readonly XToken[] = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.BSC_MAINNET);

// All supported swap tokens across every spoke chain
const allTokens: Record<SpokeChainKey, readonly XToken[]> = sodax.swaps.getSupportedSwapTokens();
```

### RWA classification and token logos

`XToken.isRwa === true` marks a registered tokenized stock, ETF or commodity,
including registered cross-chain representations. An omitted flag means no RWA
classification is declared; it is not a general-purpose crypto/stablecoin taxonomy.
Chain membership and symbol spelling do not determine RWA status.

Use `isRealWorldAsset({ chainKey, address })` to resolve metadata from the packaged
SDK registry when your token data comes from an API without the flag. It returns
false for unknown chains or addresses, ignores symbols, and compares EVM addresses
case-insensitively while preserving non-EVM identifier casing. It does not read
custom constructor config or validate swap/money-market support. New registry
metadata requires an SDK update; it does not automatically update backend payloads.

```typescript
import { ChainKeys, getSupportedSolverTokens, isRealWorldAsset, tokenLogo } from '@sodax/sdk';

const tokens = getSupportedSolverTokens(ChainKeys.ROBINHOOD_MAINNET);
const rwaTokens = tokens.filter(isRealWorldAsset);
const rows = tokens.map(token => ({
  symbol: token.symbol,
  isRwa: isRealWorldAsset(token),
  logo: tokenLogo(token.symbol),
}));
```

For API responses using `xChainId`, pass it as `chainKey` alongside the token's
on-chain `address`. Resolve each chain/address before grouping directory rows;
keep feature support and UI visibility filters separate from classification.

`tokenLogo(symbol)` serves shared PNGs from the SDK repository's `main` branch.
Robinhood equity/ETF entries use the Robinhood mark; xStocks retain their own
artwork. Image replacements become available after merge, subject to caching,
without an SDK release. Consumers must use these URLs to receive the replacements.

## Available Methods

All swap methods are accessible through `sodax.swaps`:

### Quote & Fee Methods

- `getQuote(payload)` — Request a price quote from the solver API
- `getPartnerFee(inputAmount)` — Calculate the partner fee for a given input amount
- `getSolverFee(inputAmount)` — Calculate the solver protocol fee (0.1%) for a given input amount
- `getSwapDeadline(offset?)` — Compute an absolute deadline timestamp for an intent

### Intent Creation & Execution

- `swap(params)` — Full end-to-end swap (recommended — handles all steps automatically); signed execution only
- `createIntent(params)` — Create an intent on the source spoke chain; supports both signed (`raw: false`) and raw (`raw: true`) modes
- `createLimitOrder(params)` — Full end-to-end limit order (no deadline, must be cancelled manually); signed execution only
- `createLimitOrderIntent(params)` — Create a limit order intent only (no relay/solver notify); supports raw and signed modes
- `submitIntent(payload)` — Submit a spoke tx to the relay API (low-level, called automatically by `swap` on its fallback path)
- `postExecution(request)` — Notify the solver that an intent is live on the hub chain (low-level, called automatically by `swap` on its fallback path)

Driving these steps yourself instead of calling `swap`? See [Migrate a manual swap to the backend submit-tx flow](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MIGRATE_SWAP_TO_SUBMIT_TX.md).

#### Backend 2-step submit

By default `swap()` uses a backend-driven 2-step flow (`swaps.useBackendSubmitTx`, default `true`): after `createIntent` broadcasts the intent tx, `swap()` hands the tx hash to the backend (`sodax.api.swaps.submitTx`), which relays + post-executes server-side; the SDK polls submit-tx status and returns the same `SwapResponse`. The SDK does **not** verify the tx on-chain first — the backend runs its own verification, so waiting for a client-side confirmation would delay every backend success by the source chain's confirmation wait and could fail a swap the backend would have completed. `verifyTxHash` therefore runs only on the client-side path. Set `new Sodax({ swaps: { useBackendSubmitTx: false } })` to force the fully client-side relay path.

On **any** non-success (submission rejected, terminal `failed`/abandoned, or poll timeout) `swap()` **falls back** to the client-side relay so the swap still completes — identical `SwapResponse` either way. This is **safe**: re-relaying / re-posting an already-processed swap is idempotent — the relay dedups and returns the existing `executed` packet, and the solver re-affirms the intent (no double-fill), verified live by `e2e-tests/e2e-relay.test.ts`. It also matters in practice: the backend keeps processing at its own pace after the SDK gives up, so the two relays can race. Each attempt gets its own `timeout` — see [How `timeout` bounds each attempt](#how-timeout-bounds-each-attempt). `useBackendSubmitTx` lives on `swaps` alongside `partnerFee` (not part of the backend `SodaxDefaultConfig`). See [CONFIGURE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#backend-submit-tx-2-step-swapsusebackendsubmittx).

#### How `timeout` bounds each attempt

`timeout` (defaults to `DEFAULT_RELAY_TX_TIMEOUT`) is a **per-attempt** budget, not an end-to-end deadline. The backend attempt — the submit POST plus the status poll — gets it, and if that attempt does not complete the client-side relay wait gets a fresh one. A stalled backend therefore cannot shorten the fallback's relay wait, and raising `timeout` grows both.

Each phase is bounded by a different thing:

| Phase | Bound |
| --- | --- |
| `createIntent` — build, sign, broadcast, optional simulation | **not** bounded by `timeout` |
| Backend attempt — submit POST + status poll | `timeout` |
| ↳ any single backend request within it | `min(budget left in the attempt, api.timeout)` |
| On-chain verification — client-side path only | the source chain's `pollingConfig.maxTimeoutMs` |
| Relay wait — client-side path only, starts after verification | `max(timeout, RELAY_FALLBACK_FLOOR_MS)` |
| `postExecution` — solver notify, client-side path only | **not** bounded by `timeout` |

Read the constants from source rather than memorising them: `DEFAULT_RELAY_TX_TIMEOUT`, `DEFAULT_BACKEND_API_TIMEOUT` and per-chain `pollingConfig` live in [`@sodax/types`](https://github.com/icon-project/sodax-sdks/tree/main/packages/types/src), and `RELAY_FALLBACK_FLOOR_MS` in [`IntentRelayApiService.ts`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/shared/services/intentRelay/IntentRelayApiService.ts). Verification timeouts differ widely by chain — Stacks alone is several times Sui's — so derive them per chain from `chains.ts`.

**On the per-request bound.** `api.timeout` is configurable — `new Sodax({ api: { timeout } })` moves every backend service, and an `api.swapsApiConfig` slice moves swaps alone (there is no `bridgeApiConfig` slice; see [CONFIGURE_SDK.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#backend-api-api)). The packaged default is `DEFAULT_BACKEND_API_TIMEOUT`, and a non-positive value disables the backend submit-tx path outright. Which side of the `min` binds decides whether a stalled request retries: while `api.timeout` is the smaller bound the poll retries within the attempt, but once the attempt's remaining budget drops below it, **a single stalled request can consume the rest of the attempt**. The clamp guarantees a request can never be configured to outlive the attempt — not that the attempt survives a slow request.

**Worst-case wall-clock**, when the backend accepts the submission and then never finishes:

```
createIntent + timeout (backend attempt) + verification + max(timeout, RELAY_FALLBACK_FLOOR_MS) + postExecution
```

Only the two `timeout` terms are yours to tune. Opting out with `useBackendSubmitTx: false` drops the backend-attempt term entirely.

### Intent Management

- `getIntent(txHash)` — Retrieve an `Intent` from a hub-chain transaction hash
- `getFilledIntent(txHash)` — Retrieve the fill state of an intent from the solver's fill tx hash
- `getIntentSubmitTxExtraData(params)` — Rebuild the relay extra data (`address` + `payload`) for a Solana/Bitcoin intent from a hub-chain tx hash or an `Intent`; byte-identical to the `relayData` that `createIntent` returned
- `reconstructRelayData(intent)` — The same relay extra data, derived offline from a fully-populated `Intent` (no RPC call)
- `getSolvedIntentPacket(params)` — Poll the relayer until a solved intent's fill packet arrives on the destination chain
- `getIntentHash(intent)` — Compute the keccak256 hash of an intent (its on-chain ID)
- `getStatus(request)` — Poll the solver API for current intent execution status
- `getDetailedStatus(params)` — Read a swap's status from its **source-chain** tx hash; routes to the backend record or the solver, whichever can answer
- `cancelIntent(params)` — Cancel an active intent and wait for hub confirmation
- `createCancelIntent(params)` — Build (and optionally broadcast) only the cancel tx; supports raw and signed modes
- `getCancelIntentRelayData(intent)` — Relay extra data (`address` + `payload`) for manually relaying a Solana cancel tx
- `cancelLimitOrder(params)` — Alias for `cancelIntent` with domain-specific naming

### Token Approval

- `isAllowanceValid(params)` — Check if the spender contract has sufficient token allowance
- `approve(params)` — Approve token spend (EVM/Sonic/Stellar); supports raw and signed modes

### Utility Methods

- `getSupportedSwapTokensByChainId(chainId)` — Get supported swap tokens for a spoke chain
- `getSupportedSwapTokens()` — Get all supported swap tokens per chain
- `estimateGas(params)` — Estimate gas for a raw transaction on any spoke chain
- `getSwapSpeedTier({ srcToken, dstToken })` — Offline estimate of how fast a token pair will settle

## Core Concepts

### `srcChainKey` / `dstChainKey`

All action params use `srcChainKey` and `dstChainKey` (not `srcChain` / `dstChain`). These are `SpokeChainKey` strings from `ChainKeys.*`.

The on-chain `Intent` struct has `Intent.srcChain` / `Intent.dstChain` as `IntentRelayChainId` (bigint relay IDs) — these are different from the action param fields and should not be confused with them.

### Signed vs Raw Mode (`raw: true / false`)

Methods that accept a `raw` flag return different types depending on the value:

- **`raw: false`** (default) — requires a `walletProvider` matching the source chain type; signs and broadcasts the transaction; returns a tx hash.
- **`raw: true`** — `walletProvider` must be absent (passing one is a compile error); returns an unsigned raw transaction payload.

TypeScript enforces this at compile time via the `WalletProviderSlot<K, Raw>` discriminated union:

```typescript
// Signed execution — walletProvider required, chain-narrowed by srcChainKey
await sodax.swaps.createIntent({
  params: { srcChainKey: ChainKeys.BSC_MAINNET, ...otherParams },
  walletProvider: evmWalletProvider, // must be IEvmWalletProvider for BSC
});

// Raw mode — walletProvider must be absent
await sodax.swaps.createIntent({
  params: { srcChainKey: ChainKeys.BSC_MAINNET, ...otherParams },
  raw: true,
  // walletProvider here would be a compile error
});
```

**Methods with raw support:** `createIntent`, `createLimitOrderIntent`, `createCancelIntent`, `approve`

**Methods without raw support (signed execution only):** `swap`, `createLimitOrder`, `cancelIntent`, `cancelLimitOrder`

### `ChainKeys.*` Constants

All chain identifiers come from `ChainKeys`:

```typescript
import { ChainKeys } from '@sodax/sdk';

ChainKeys.BSC_MAINNET         // '0x38.bsc'
ChainKeys.ARBITRUM_MAINNET    // '0xa4b1.arbitrum'
ChainKeys.ETHEREUM_MAINNET    // 'ethereum'
ChainKeys.SOLANA_MAINNET      // 'solana'
ChainKeys.SONIC_MAINNET       // 'sonic'  (hub chain)
```

### `Result<T>` — No Throws Across Service Boundaries

Every public async method returns `Promise<Result<T, E>>`:

```typescript
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Check `result.ok` before accessing `result.value` or `result.error`. **For the swap module's user-facing methods**, the error type is narrowed to `SodaxError<NarrowCode>` per method — see "Error Handling" below.

### Error Handling

The swap module's three core methods (`swap`, `createIntent`, `postExecution`) return a deterministic, narrow `SodaxError` union. `createLimitOrder` / `createLimitOrderIntent` inherit the same shape because they delegate.

#### The canonical error: `SodaxError<C>`

All swap-module errors are instances of `SodaxError`, exported from `@sodax/sdk`:

```typescript
import { SodaxError, isSodaxError } from '@sodax/sdk';

class SodaxError<C extends SodaxErrorCode = SodaxErrorCode> extends Error {
  readonly code: C;                  // string-literal discriminator
  readonly cause?: unknown;          // ES2022 cause chain
  readonly context?: Record<string, unknown>;
  toJSON(): { name, code, feature, message, stack, context, cause };
}

function isSodaxError(e: unknown): e is SodaxError;
```

**Rules:**

- Discriminate on `error.code` — never on `error.message` (the message is a human-readable explanation, not a stable contract).
- `error.cause` walks the underlying error chain (ES2022). Loggers like Sentry/Pino/Datadog walk this automatically.
- `error.context` carries structured metadata: `srcChainKey`, `dstChainKey`, `phase`, plus per-code extras (`solverCode`, `relayCode`, `field`, …).
- `error.toJSON()` is the canonical logger surface: `JSON.stringify(error)` invokes it automatically and produces a logger-safe payload (bigints in `context` are coerced to strings, cause walked depth-3, no circular hazards).
- Use `isSodaxError(e)` instead of `instanceof SodaxError` in dapp/app code — it survives duplicate-bundle and dual-package scenarios.

#### Per-method error code unions

| Method | Error type | Codes |
|---|---|---|
| `swap` | `SwapError` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXECUTION_FAILED`, `EXTERNAL_API_ERROR`, `UNKNOWN` |
| `createIntent` / `createLimitOrderIntent` | `SwapCreateIntentError` | `USER_REJECTED`, `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `postExecution` | `PostExecutionError` | `EXECUTION_FAILED`, `EXTERNAL_API_ERROR`, `UNKNOWN` |
| `createLimitOrder` | `SwapError` | (same as `swap`) |

**Important:** `postExecution` alone never emits relay/verify codes — those appear only on `swap` because only `swap` orchestrates verify + relay. Don't write a unified switch that handles both with the same union. Note that `swap` orchestrates verify + relay only on the **client-side path** (the fallback, or `useBackendSubmitTx: false`), so `TX_VERIFICATION_FAILED` and `phase: 'verify'` never surface on a swap the backend completes.

#### Standard `context` fields

```typescript
{
  srcChainKey?: SpokeChainKey;
  dstChainKey?: SpokeChainKey;
  phase?: 'validate' | 'intentCreation' | 'verify' | 'submit' | 'relay' | 'approve' | 'lookup' | 'execution' | 'postExecution';
  // Only on EXTERNAL_API_ERROR:
  api?: 'solver';                // discriminator for upstream API errors (used as Sentry/Datadog tag)
  solverCode?: SolverIntentErrorCode;
  solverDetail?: SolverErrorResponse['detail'];
  // Only on RELAY_TIMEOUT / TX_SUBMIT_FAILED / RELAY_FAILED:
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  // Only on VALIDATION_FAILED:
  field?: string;
  reason?: string;
}
```

#### Discrimination example

```typescript
import { isSodaxError, SolverIntentErrorCode, type SwapError } from '@sodax/sdk';

const result = await sodax.swaps.swap({ params, walletProvider });

if (!result.ok) {
  const err: SwapError = result.error;

  switch (err.code) {
    case 'VALIDATION_FAILED':
      // Human-readable reason in err.message; structured details in err.context.
      console.error('Bad input:', err.message);
      break;

    case 'INTENT_CREATION_FAILED':
      // Spoke deposit / intent construction failed.
      console.error('Intent creation failed:', err.cause);
      break;

    case 'TX_VERIFICATION_FAILED':
      // Spoke tx could not be verified on-chain.
      break;

    case 'TX_SUBMIT_FAILED':
      // CRITICAL: spoke tx landed but relay submission failed. Persist the spoke tx hash
      // and retry submission — funds may otherwise be inaccessible.
      console.error('Relay submit failed; retry needed:', err.context?.relayCode);
      break;

    case 'RELAY_TIMEOUT':
      // Relay packet didn't confirm in time. Check intent status and retry with longer timeout.
      break;

    case 'RELAY_FAILED':
      // Polling-side failure or unrecognised relay error. Distinguish via err.context.relayCode:
      //   - 'RELAY_POLLING_FAILED' — the polling endpoint failed (network down, malformed
      //     response). The packet's actual status is unknown; query the hub directly to confirm.
      //   - 'UNKNOWN' — forward-compat fallback for new relay error codes.
      break;

    case 'EXECUTION_FAILED':
      // Solver notify failed at the transport layer (network down, etc.).
      break;

    case 'EXTERNAL_API_ERROR': {
      // Solver returned a typed error. Original SolverIntentErrorCode is in context.
      const solverCode = err.context?.solverCode as SolverIntentErrorCode | undefined;
      if (solverCode === SolverIntentErrorCode.NO_PATH_FOUND) {
        // …
      }
      break;
    }

    case 'UNKNOWN':
      console.error('Unexpected error:', err.cause);
      break;
  }
}
```

#### Relay-layer contract

The lower-level relay helpers `relayTxAndWaitPacket` and `submitTransaction` (in `packages/sdk/src/shared/services/intentRelay/IntentRelayApiService.ts`) emit three stable error message strings on failure: `'SUBMIT_TX_FAILED'`, `'RELAY_TIMEOUT'` and `'RELAY_POLLING_FAILED'`. These are exported as `RELAY_ERROR_CODES` and form a public contract. Only `dex` consumes them directly; every other feature module maps them into a typed `SodaxError` via `mapRelayFailure`.

The swap module wraps these via the unified `mapRelayFailure`, surfacing the original code on `error.context.relayCode` so swap callers don't need to inspect `error.cause.message`.

#### Migration from pre-`SodaxError` (breaking)

If you were on the previous `Error.message`-based pattern:

| Before | After |
|---|---|
| `result.error instanceof Error && result.error.message === 'POST_EXECUTION_FAILED'` | `result.error.code === 'EXECUTION_FAILED'` |
| `result.error.message === 'RELAY_TIMEOUT'` | `result.error.code === 'RELAY_TIMEOUT'` |
| `result.error.message === 'SUBMIT_TX_FAILED'` | `result.error.code === 'TX_SUBMIT_FAILED'` |
| `(result.error as SolverErrorResponse).detail.code` (from `postExecution`) | `result.error.context?.solverCode` |
| `(result.error as SolverErrorResponse).detail` | `result.error.context?.solverDetail` |
| Prose `error.message` for invariants | `error.code === 'VALIDATION_FAILED'`; the prose stays on `error.message` |

The full `SolverErrorResponse` payload is preserved on `error.context.solverDetail`, so anything you read from `.detail.*` previously is still reachable.

Other swap methods (`getQuote`, `getStatus`, `submitIntent`, `cancelIntent`, etc.) and other modules (`moneyMarket`, `bridge`, `dex`, …) **retain their legacy error shapes in this release** — they still use the `Error | unknown` / `SolverErrorResponse` patterns documented per-module, rather than migrating to `SodaxError`.

---

## Request a Quote

Requesting a quote requires the user's input amount scaled by the token's decimals. All token addresses and decimals are available via `sodax.config`.

The quoting API supports a single quote type, `'exact_input'` — the user specifies the amount to swap and the solver returns the amount they receive. There is no "exact output" mode; the API rejects any other value.

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { SolverIntentQuoteRequest, SolverErrorResponse } from '@sodax/sdk';

const sodax = new Sodax();

const bscEthToken = '0x2170Ed0880ac9A755fd29B2688956BD959F933F8';  // ETH on BSC
const arbWbtcToken = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f'; // wBTC on Arbitrum

const quoteRequest = {
  token_src: bscEthToken,
  token_dst: arbWbtcToken,
  token_src_blockchain_id: ChainKeys.BSC_MAINNET,
  token_dst_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  amount: 1_000_000_000_000_000n, // 1 WETH (18 decimals)
  quote_type: 'exact_input',
} satisfies SolverIntentQuoteRequest;

const result = await sodax.swaps.getQuote(quoteRequest);

if (result.ok) {
  const { quoted_amount } = result.value;
  console.log('Quoted amount:', quoted_amount);
} else {
  // result.error is SolverErrorResponse — check result.error.detail.code
  console.error('Quote failed:', result.error);
}
```

**Note:** `getQuote` automatically deducts the configured partner fee from `payload.amount` before forwarding to the solver, so the returned `quoted_amount` reflects the net output the user actually receives.

---

## Intent Parameters

### `CreateIntentParams<K>`

```typescript
import type { CreateIntentParams } from '@sodax/sdk';
import { ChainKeys } from '@sodax/sdk';

const createIntentParams = {
  inputToken: '0x...',           // Input token address on the source spoke chain
  outputToken: '0x...',          // Output token address on the destination spoke chain
  inputAmount: 1_000_000n,       // Gross input amount (fee will be deducted from this)
  minOutputAmount: 900_000n,     // Minimum acceptable output amount
  deadline: 0n,                  // Unix timestamp after which intent expires (0 = no expiry)
  allowPartialFill: false,       // Whether the intent can be partially filled
  srcChainKey: ChainKeys.BSC_MAINNET,       // Source chain key
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,  // Destination chain key
  srcAddress: '0x...',           // User's address on the source chain
  dstAddress: '0x...',           // Recipient address on the destination chain
  solver: '0x0000000000000000000000000000000000000000', // Optional: Specific solver (address(0) = any)
  data: '0x',                    // Additional arbitrary data
} satisfies CreateIntentParams<typeof ChainKeys.BSC_MAINNET>;
```

### `CreateLimitOrderParams<K>`

Same as `CreateIntentParams` but `deadline` is optional (it is forced to `0n` by `createLimitOrder` / `createLimitOrderIntent`):

```typescript
import type { CreateLimitOrderParams } from '@sodax/sdk';

const limitOrderParams = {
  inputToken: '0x...',
  outputToken: '0x...',
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  // deadline omitted — will be set to 0n automatically
  allowPartialFill: false,
  srcChainKey: ChainKeys.BSC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x...',
  dstAddress: '0x...',
  solver: '0x0000000000000000000000000000000000000000', // optional solver address
  data: '0x',
} satisfies CreateLimitOrderParams<typeof ChainKeys.BSC_MAINNET>;
```

---

## Get Fees

### Partner Fee

```typescript
// Calculate partner fee for a given input amount
const inputAmount = 1_000_000_000_000_000n; // 1 WETH (18 decimals)
const partnerFee = sodax.swaps.getPartnerFee(inputAmount);

console.log('Partner fee:', partnerFee);               // Returns 0n if no partner fee configured
console.log('Net swap amount:', inputAmount - partnerFee);
```

The partner fee is deducted from the input amount before the intent is created. If no partner fee is configured on the `Sodax` instance, `getPartnerFee` returns `0n`.

### Solver Fee

```typescript
// Calculate the 0.1% solver protocol fee
const inputAmount = 1_000_000_000_000_000n;
const solverFee = sodax.swaps.getSolverFee(inputAmount);

console.log('Solver fee (0.1%):', solverFee);
```

---

## Get Swap Deadline

Fetches the current hub-chain (Sonic) block timestamp and adds a deadline offset. Pass the result as `CreateIntentParams.deadline`.

```typescript
// Default 5-minute offset (DEFAULT_DEADLINE_OFFSET = 300 seconds)
const deadlineResult = await sodax.swaps.getSwapDeadline();
if (deadlineResult.ok) {
  console.log('Deadline (5 min from now):', deadlineResult.value);
}

// Custom 10-minute offset
const customDeadlineResult = await sodax.swaps.getSwapDeadline(600n); // 600 seconds
if (customDeadlineResult.ok) {
  const createIntentParams = {
    // ...
    deadline: customDeadlineResult.value,
    // ...
  };
}
```

For limit orders, pass `deadline: 0n` directly to `createIntent` (or use `createLimitOrder` / `createLimitOrderIntent` which force `0n` automatically).

---

## Get Swap Speed Tier

Offline, rule-based estimate of how fast a `srcToken` → `dstToken` swap will settle. It is derived purely from SDK config — **no network, on-chain, or backend call** — so it is safe to call synchronously while rendering a quote. Tokens whose `vault` is a money-market-reserve (sodaAsset) settle faster, and an Ethereum leg adds a fixed penalty.

```typescript
const { tier, estimatedSeconds } = sodax.swaps.getSwapSpeedTier({ srcToken, dstToken });

console.log(tier); // 'fast' | 'normal' | 'slow'
console.log(estimatedSeconds); // e.g. 15
```

`estimatedSeconds` is the source of truth; `tier` is bucketed from it. The rules: a fast base (15s) applies when **either** token's `vault` is a money-market reserve, otherwise the base is 35s; an Ethereum leg on either side adds a fixed penalty. The check is on `XToken.vault`, not `XToken.hubAsset` — the two differ for most tokens, and only the vault is a reserve address. See `estimateSwapSpeedTier` in the SDK source for the exact constants.

---

## Token Approval Flow

`swap()` and `createIntent()` do not approve the input token for you. Before executing, call `isAllowanceValid()` and `approve()` when it returns `false`. On EVM chains this is an ERC-20 allowance; on Stellar it is a trustline; on other chains it returns `true` and no approval is needed. Native gas tokens on EVM need no approval.

- **Hub (Sonic)**: checks allowance against the intents contract
- **EVM spoke chains**: checks allowance against the spoke's asset manager
- **Stellar**: checks trustline sufficiency
- **Other chains (Solana, NEAR, etc.)**: always returns `true` — no on-chain allowance concept

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { IEvmWalletProvider } from '@sodax/sdk';

// evmWalletProvider comes from wallet-sdk-core (EvmWalletProvider) or
// useWalletProvider({ xChainId: ChainKeys.BSC_MAINNET }) from wallet-sdk-react
declare const evmWalletProvider: IEvmWalletProvider;

const createIntentParams = {
  srcChainKey: ChainKeys.BSC_MAINNET,
  inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  inputAmount: 1_000_000n,
  srcAddress: await evmWalletProvider.getWalletAddress(),
  // ... other params
};

const allowanceResult = await sodax.swaps.isAllowanceValid({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});

if (!allowanceResult.ok) {
  console.error('Allowance check failed:', allowanceResult.error);
} else if (!allowanceResult.value) {
  // Approval needed
  const approveResult = await sodax.swaps.approve({
    params: createIntentParams,
    walletProvider: evmWalletProvider,
  });

  if (!approveResult.ok) {
    console.error('Approve failed:', approveResult.error);
  } else {
    console.log('Approval tx hash:', approveResult.value);
    // Wait for the approval tx to be mined before proceeding
  }
}
```

### Raw Approval Transaction

```typescript
// Get raw (unsigned) approval tx data — no walletProvider needed
const approveResult = await sodax.swaps.approve({
  params: createIntentParams,
  raw: true,
});

if (approveResult.ok) {
  const rawTx = approveResult.value; // EvmRawTransaction: { from, to, value, data }
  console.log('Raw approval tx:', rawTx);
}
```

`approve({ raw: true })` always returns exactly one transaction. That is not enough for an ERC-20 of
the 2017 TetherToken lineage — Ethereum USDT is the one in the SODAX token list today — which
rejects an allowance change from one non-zero value to another: a wallet holding a stale allowance
has to send `approve(0)` first. Use `buildApproveTxs` when you build unsigned transactions and want
that case handled:

```typescript
const result = await sodax.swaps.buildApproveTxs({
  params: createIntentParams,
  raw: true,
});

if (result.ok) {
  const { resetTx, approveTx } = result.value;

  if (resetTx) {
    // The approve is not valid until the reset has landed on-chain, so wait for it.
    await waitForTransactionReceipt(await sendTransaction(resetTx));
  }

  await waitForTransactionReceipt(await sendTransaction(approveTx));
}
```

`resetTx` is absent for every other token and for a wallet with nothing approved yet, so the common
path is a single transaction. The transactions are named rather than ordered — there is no index to
map and no way to broadcast them the wrong way round.

### Stellar Trustline

For Stellar as the source chain, `isAllowanceValid` checks trustline balance sufficiency and `approve` adds/increases the trustline. For Stellar as the **destination** chain, frontends must manually establish trustlines before executing swaps. See `packages/sdk/docs/STELLAR_TRUSTLINE.md` for details.

---

## Estimate Gas for Raw Transactions

```typescript
import { ChainKeys } from '@sodax/sdk';
import type { EstimateGasParams } from '@sodax/sdk';

// Get a raw intent tx first
const createIntentResult = await sodax.swaps.createIntent({
  params: createIntentParams,
  raw: true,
});

if (createIntentResult.ok) {
  const { tx: rawTx } = createIntentResult.value;

  // Estimate gas — provide the chain key and the raw tx
  const gasResult = await sodax.swaps.estimateGas({
    chainKey: ChainKeys.BSC_MAINNET,
    tx: rawTx,
  } satisfies EstimateGasParams<typeof ChainKeys.BSC_MAINNET>);

  if (gasResult.ok) {
    console.log('Estimated gas:', gasResult.value);
  }
}
```

---

## Swap (Recommended)

The `swap` method is the recommended way to perform a complete cross-chain swap. It orchestrates the full lifecycle automatically:

1. Calls `createIntent` to submit the intent transaction on the source spoke chain
2. **Backend attempt** (default, `swaps.useBackendSubmitTx`): hands the broadcast tx to `sodax.api.swaps.submitTx` — which verifies, relays and post-executes server-side — then polls submit-tx status until the intent is `solved`
3. **On any non-success, falls back** to the fully client-side path: verifies the spoke transaction landed on-chain, then for non-hub source chains submits the spoke tx to the relayer and waits for the relay packet to land on the hub (Sonic), then calls `postExecution` to notify the solver, triggering it to fill the intent

Both paths return an identical `SwapResponse`. See [Backend 2-step submit](#backend-2-step-submit) for the flag, the fallback conditions and why re-relaying is safe.

`swap` is signed-only (no `raw: true` mode) — use `createIntent` if you need raw transaction data. If you orchestrate the steps yourself instead of calling `swap`, see [Migrate a manual swap to the backend submit-tx flow](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MIGRATE_SWAP_TO_SUBMIT_TX.md) — the backend attempt and the fallback are not automatic on that path.

```typescript
import { Sodax, ChainKeys } from '@sodax/sdk';
import type { IEvmWalletProvider, SwapResponse } from '@sodax/sdk';

declare const evmWalletProvider: IEvmWalletProvider;

// `deadline` is an absolute Unix timestamp — getSwapDeadline turns an offset into one
const deadlineResult = await sodax.swaps.getSwapDeadline(300n); // 5 minutes from now
if (!deadlineResult.ok) throw deadlineResult.error;

const swapResult = await sodax.swaps.swap({
  params: {
    inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    outputToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    inputAmount: 1_000_000_000_000_000n,
    minOutputAmount: 900_000n,
    deadline: deadlineResult.value,
    allowPartialFill: false,
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: await evmWalletProvider.getWalletAddress(),
    dstAddress: '0x...',
    solver: '0x0000000000000000000000000000000000000000', // optional
    data: '0x',
  },
  walletProvider: evmWalletProvider,
  timeout: 120_000,        // optional — relay timeout in ms (default: DEFAULT_RELAY_TX_TIMEOUT = 120 s)
  skipSimulation: false,   // optional — skip spoke tx simulation (default: false)
  // extras: { partnerFee, apiKey }, // optional per-action overrides — see note below
});

if (!swapResult.ok) {
  // See Error Handling section for how to branch on specific error codes
  console.error('Swap failed:', swapResult.error);
} else {
  const { solverExecutionResponse, intent, intentDeliveryInfo }: SwapResponse = swapResult.value;
  console.log('Solver acknowledged:', solverExecutionResponse.answer); // 'OK'
  console.log('Hub tx hash:', intentDeliveryInfo.dstTxHash);
}
```

The optional `extras` slot carries per-action overrides: `extras.partnerFee` replaces the configured
swap partner fee for this action, and `extras.apiKey` replaces the configured backend API key
(`x-api-key`) for this action's backend submit-tx leg. Both fall back to the `Sodax` config when
omitted — see
[CONFIGURE_SDK.md § API key](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md#api-key).
Pass `extras.apiKey` only from server-side code: a key in a browser bundle is public — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

---

## Create Intent Only

Use `createIntent` when you need raw transaction data or want to control the relay step yourself. For the full lifecycle, prefer `swap`.

### Signed execution

```typescript
const createIntentResult = await sodax.swaps.createIntent({
  params: createIntentParams, // CreateIntentParams<typeof ChainKeys.BSC_MAINNET>
  walletProvider: evmWalletProvider,
  skipSimulation: false, // optional
});

if (createIntentResult.ok) {
  const { tx: spokeTxHash, intent, relayData } = createIntentResult.value;
  console.log('Spoke tx hash:', spokeTxHash);
  console.log('Intent fee amount:', intent.feeAmount);
}
```

### Raw transaction

```typescript
const createIntentResult = await sodax.swaps.createIntent({
  params: createIntentParams,
  raw: true, // walletProvider must be absent
});

if (createIntentResult.ok) {
  const { tx: rawTx, intent, relayData } = createIntentResult.value;
  // rawTx is EvmRawTransaction: { from, to, value, data }
  // relayData is RelayExtraData: { address, payload } — needed for submitIntent
  console.log('Raw tx:', rawTx);
}
```

---

## Limit Orders

A limit order is an intent with `deadline = 0n` — it stays active indefinitely until filled at `minOutputAmount` or manually cancelled.

### Create Limit Order (full lifecycle)

```typescript
import type { IEvmWalletProvider } from '@sodax/sdk';

declare const evmWalletProvider: IEvmWalletProvider;

const limitOrderResult = await sodax.swaps.createLimitOrder({
  params: {
    inputToken: '0x...',
    outputToken: '0x...',
    inputAmount: 1_000_000n,
    minOutputAmount: 900_000n,
    // deadline omitted — forced to 0n
    allowPartialFill: false,
    srcChainKey: ChainKeys.BSC_MAINNET,
    dstChainKey: ChainKeys.ARBITRUM_MAINNET,
    srcAddress: '0x...',
    dstAddress: '0x...',
    solver: '0x0000000000000000000000000000000000000000', // optional
    data: '0x',
  },
  walletProvider: evmWalletProvider,
});

if (limitOrderResult.ok) {
  const { intent } = limitOrderResult.value;
  const intentHash = sodax.swaps.getIntentHash(intent);
  console.log('Limit order intent hash:', intentHash);
}
```

### Create Limit Order Intent (intent tx only — no relay/solver notify)

```typescript
// Signed
const result = await sodax.swaps.createLimitOrderIntent({
  params: limitOrderParams,
  walletProvider: evmWalletProvider,
});

// Raw
const rawResult = await sodax.swaps.createLimitOrderIntent({
  params: limitOrderParams,
  raw: true,
});
```

### Cancel Limit Order / Cancel Intent

`cancelLimitOrder` is a domain-specific alias for `cancelIntent`. Both take an object with `srcChainKey` and `intent`.

**Important:** `cancelIntent` takes `{ params: CancelIntentParams<K>, walletProvider }` — not positional arguments. You must supply `srcChainKey` explicitly because `Intent.srcChain` is a bigint relay ID that cannot narrow to a `SpokeChainKey` at the type level.

```typescript
import type { Intent, TxHashPair } from '@sodax/sdk';

// Retrieve the intent by hub-chain tx hash (or use the intent from createIntent/swap response)
const intentResult = await sodax.swaps.getIntent(hubTxHash);
if (!intentResult.ok) {
  console.error('Failed to fetch intent:', intentResult.error);
  return;
}
const intent: Intent = intentResult.value;

// Cancel the intent
const cancelResult = await sodax.swaps.cancelIntent({
  params: {
    srcChainKey: ChainKeys.BSC_MAINNET, // must match intent.srcChain
    intent,
  },
  walletProvider: evmWalletProvider,
  timeout: 60_000, // optional relay timeout (ms)
});

if (cancelResult.ok) {
  const { srcChainTxHash, dstChainTxHash }: TxHashPair = cancelResult.value;
  console.log('Cancel spoke tx:', srcChainTxHash);
  console.log('Cancel hub tx:', dstChainTxHash);
} else {
  console.error('Cancel failed:', cancelResult.error);
}
```

`cancelIntent` relays the cancel the same way `swap()` relays the intent: on Solana it submits the cancel payload alongside the spoke tx (the tx itself carries only the payload hash), and on Bitcoin it relays the signed on-demand payload — no extra input is needed from the caller. On Bitcoin no spoke transaction is broadcast, so `srcChainTxHash` is the relay's derived `od:<hash>` identifier rather than a chain tx hash.

The cancel message is sent from the intent's `srcAddress` by default. A Bitcoin intent created in TRADING mode stores the trading address, while the cancel must be signed from the personal wallet — signed cancels read that address from `walletProvider`, so nothing changes for `cancelIntent`. Pass `params.srcAddress` only to override it (required for a raw Bitcoin cancel, see below).

> **Error-type note:** `cancelIntent` and `cancelLimitOrder` return `Result<TxHashPair, Error | unknown>` — they were **not** migrated to the `SodaxError<C>` family. Don't `switch` on `error.code` here; treat the error as an opaque `Error` and use `instanceof Error` / `error.message` for diagnostics. The rest of this module (swap, createIntent, postExecution, createLimitOrder, createLimitOrderIntent) uses `SodaxError<SwapErrorCode>` — see [Error Handling](#error-handling).

### Build Cancel Intent (raw or signed — no relay wait)

Use `createCancelIntent` when you need only the cancel transaction (e.g. for gas estimation or manual relay):

```typescript
// Raw cancel tx
const rawCancelResult = await sodax.swaps.createCancelIntent({
  params: { srcChainKey: ChainKeys.BSC_MAINNET, intent },
  raw: true,
});

// Raw Bitcoin cancel in TRADING mode: there is no wallet provider to read the personal address
// from, and the intent stores the trading address, so the personal wallet address is required.
const rawBtcCancelResult = await sodax.swaps.createCancelIntent({
  params: { srcChainKey: ChainKeys.BITCOIN_MAINNET, intent: btcIntent, srcAddress: personalBtcAddress },
  raw: true,
});

if (rawCancelResult.ok) {
  // rawTx is the chain-specific raw transaction (EvmRawTransaction for EVM chains,
  // SolanaRawTransaction for Solana, etc.) — TypeScript narrows it from `srcChainKey`.
  const rawTx = rawCancelResult.value;
}
```

Relaying a cancel tx yourself follows [Submit Intent to Relay API](#submit-intent-to-relay-api), with one difference per chain family. On Solana the spoke tx carries only the payload hash, so pass `data` from `getCancelIntentRelayData(intent)` — the create-intent helpers (`getIntentSubmitTxExtraData`, `reconstructRelayData`) encode a different payload and do not match a cancel tx. On Bitcoin `createCancelIntent` returns the signed on-demand payload JSON rather than a tx hash; submit it under the literal `withdraw` tx hash with the parsed payload as `data`, and poll the derived `od:<hash>` id — `BitcoinSpokeService.getOnDemandRelayIdentity` (`sodax.spoke.bitcoin`) returns all three.

```typescript
const cancelRelayData = sodax.swaps.getCancelIntentRelayData(intent);
if (cancelRelayData.ok) {
  await sodax.swaps.submitIntent({
    action: 'submit',
    params: { chain_id: intent.srcChain.toString(), tx_hash: solanaCancelTxHash, data: cancelRelayData.value },
  });
}
```

---

## Submit Intent to Relay API

Called automatically by `swap` — but only on its **fallback** path; the backend attempt relays server-side instead. Use this manually if you called `createIntent` separately. If you are orchestrating the steps yourself, try `sodax.api.swaps.submitTx` first and keep this as your fallback — see [Migrate a manual swap to the backend submit-tx flow](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MIGRATE_SWAP_TO_SUBMIT_TX.md).

```typescript
import type { IntentRelayRequest } from '@sodax/sdk';

const submitPayload = {
  action: 'submit',
  params: {
    chain_id: '0x38.bsc', // intentRelayChainId string for the source chain
    tx_hash: spokeTxHash,
    // data: relayData, // include when srcChain is Solana or Bitcoin
  },
} satisfies IntentRelayRequest<'submit'>;

const submitResult = await sodax.swaps.submitIntent(submitPayload);

if (submitResult.ok) {
  console.log('Relay accepted:', submitResult.value.success);
} else {
  console.error('Relay submission failed:', submitResult.error);
  // IMPORTANT: Store spokeTxHash + submitPayload in local storage and retry.
  // If the user leaves before this succeeds, funds may be stuck until re-submission.
}
```

---

## Get Intent Submit Tx Extra Data

Required only when the source chain is **Solana** or **Bitcoin**. Pass the returned `RelayExtraData` as `data` in `submitIntent` (or `relayTxAndWaitPacket`).

Those deposits commit only a hash of the relay payload on-chain, so the relayer can correlate a submission only with the exact original bytes. For an intent created by `createIntent` (or `swap` / `createLimitOrderIntent`) the payload returned here is byte-identical to the `relayData` that call returned — raw `createIntent` calldata for a Sonic-hub source, the `[approve, createIntent]` multicall for any spoke source — which makes this the recovery path when that runtime `relayData` is no longer available.

One intent shape cannot be reconstructed this way: a leverage-yield `vaultSwap` / `createVaultIntent` intent with `hubWalletSwap`. Its `srcChain` is the hub while the relayed payload is the spoke multicall sent through `sendMessage`, so passing that `intent` to `getIntentSubmitTxExtraData({ intent })` or `reconstructRelayData` yields raw `createIntent` calldata that will not match. Keep the `relayData` the leverage-yield call returned, or use `sodax.api.leverageYield.getIntentSubmitTxExtraData`.

```typescript
import type { RelayExtraData } from '@sodax/sdk';

// Option 1: derive from hub-chain tx hash
const extraDataResult = await sodax.swaps.getIntentSubmitTxExtraData({
  txHash: '0x9b8c...', // hub-chain tx hash
});

// Option 2: derive from a pre-fetched Intent
const intentResult = await sodax.swaps.getIntent(hubTxHash);
if (intentResult.ok) {
  const extraDataResult2 = await sodax.swaps.getIntentSubmitTxExtraData({
    intent: intentResult.value,
  });

  if (extraDataResult2.ok) {
    const extraData: RelayExtraData = extraDataResult2.value;
    // Use extraData.address and extraData.payload in the relay submit request
  }

  // Option 3: fully offline — same payload, no RPC call, from a fully-populated Intent
  const offlineResult = sodax.swaps.reconstructRelayData(intentResult.value);
}
```

---

## Post Execution to Solver API

Called automatically by `swap` after the relay packet lands on the hub — on its **fallback** path only; the backend attempt post-executes server-side. Use this manually when orchestrating the swap steps yourself; [Migrate a manual swap to the backend submit-tx flow](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/MIGRATE_SWAP_TO_SUBMIT_TX.md) shows where it belongs in the two-path model.

```typescript
import type { SolverExecutionRequest } from '@sodax/sdk';

const postExecutionResult = await sodax.swaps.postExecution({
  intent_tx_hash: hubTxHash, // hub-chain (Sonic) tx hash where the intent was registered
} satisfies SolverExecutionRequest);

if (postExecutionResult.ok) {
  const { answer, intent_hash } = postExecutionResult.value;
  console.log('Solver answer:', answer);         // 'OK'
  console.log('Intent hash:', intent_hash);
} else {
  console.error('Post execution failed:', postExecutionResult.error);
}
```

---

## Get Intent

Retrieve an `Intent` from the `IntentCreated` event on the hub chain.

```typescript
import type { Intent } from '@sodax/sdk';

const intentResult = await sodax.swaps.getIntent(hubTxHash);
if (intentResult.ok) {
  const intent: Intent = intentResult.value;
  console.log('Intent ID:', intent.intentId);
  console.log('Input amount:', intent.inputAmount);
  // Note: intent.srcChain / intent.dstChain are IntentRelayChainId (bigint),
  // not SpokeChainKey strings — use them only for relay ID comparisons.
}
```

---

## Get Filled Intent

Retrieve the fill state of an intent from the `IntentFilled` event log, emitted when a solver fills an intent on the hub chain.

```typescript
import type { IntentState } from '@sodax/sdk';

const filledIntentResult = await sodax.swaps.getFilledIntent(solverFillTxHash);

if (filledIntentResult.ok) {
  const state: IntentState = filledIntentResult.value;
  console.log('Exists:', state.exists);
  console.log('Remaining input:', state.remainingInput);
  console.log('Received output:', state.receivedOutput);
  console.log('Pending payment:', state.pendingPayment);
} else {
  console.error('No IntentFilled event found in tx:', filledIntentResult.error);
}
```

**`IntentState` fields:**
- `exists` — whether the intent exists on-chain
- `remainingInput` — unfilled input amount
- `receivedOutput` — output tokens received so far
- `pendingPayment` — whether a payment is pending

---

## Get Intent Status

Poll the solver API for the current execution status of an intent. The `intent_tx_hash` must be the hub-chain tx hash where the intent was registered. If the solver returns `NOT_FOUND` or the request fails, the backend's durable intent record is checked for a recorded fill — see [SOLVER_API_ENDPOINTS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SOLVER_API_ENDPOINTS.md).

```typescript
import { SolverIntentStatusCode } from '@sodax/sdk';
import type { SolverIntentStatusRequest } from '@sodax/sdk';

const statusResult = await sodax.swaps.getStatus({
  intent_tx_hash: hubTxHash,
} satisfies SolverIntentStatusRequest);

if (statusResult.ok) {
  const { status, fill_tx_hash } = statusResult.value;
  console.log('Status:', status); // SolverIntentStatusCode enum value

  if (status === SolverIntentStatusCode.SOLVED && fill_tx_hash) {
    console.log('Fill tx hash:', fill_tx_hash);
  }
}
```

---

## Get Detailed Status

`getDetailedStatus` answers "what is the status of this swap?" from the **source-chain** tx — the one identifier you always hold. It does not define a new status: it routes to whichever of the two existing sources can answer, and returns that source's payload unmodified.

```typescript
const result = await sodax.swaps.getDetailedStatus({
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcTxHash: swapResponse.intentDeliveryInfo.srcTxHash,
});

if (result.ok) {
  if (result.value.source === 'backend') {
    // `data` is the SubmitTxStatusDataV2 from sodax.api.swaps.getSubmitTxStatus
    console.log(result.value.data.status, result.value.data.userMessage);
  } else {
    // `data` is the SolverIntentStatusResponse from sodax.swaps.getStatus
    console.log(result.value.data.status, result.value.dstTxHash);
  }
}
```

`DetailedSwapStatus` is discriminated on `source`, so it narrows on its own — no type guards needed:

```typescript
type DetailedSwapStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse };
```

A point-in-time read — poll it yourself, or use `@sodax/dapp-kit`'s `useDetailedStatus`.

### Why it exists

`sodax.api.swaps.getSubmitTxStatus` cannot answer for every swap, in two different ways.

Sometimes there is **no record**, and it reads 404 — you opted out with `useBackendSubmitTx: false`, or the submit itself never landed. More often the record exists but is **stale**: [backend 2-step submit](#backend-2-step-submit) POSTs the tx *first* and only falls back to the client-side relay once that path stalls, so a fallback-completed swap leaves behind whatever state the backend last reached — `pending`, `relaying`, or a record it abandoned outright. Neither shape reflects what actually happened to the swap.

`sodax.swaps.getStatus` can answer for it, but needs the **hub** tx hash, which the caller may not have. So the caller had to know which path ran and pick an API. This method makes that choice instead:

1. Read the backend record; return it while it is still in play.
2. Otherwise resolve the hub tx hash — the source tx itself for hub-source swaps, else the delivered relay packet's `dst_tx_hash` — and return `getStatus`'s answer.

A record the backend **gave up on** (`failed`, or `abandonedAt` set) takes step 2, and on the default path this is the *common* branch rather than an edge case: the record almost always exists, so abandonment — not a 404 — is what usually signals the fallback ran. It never self-heals, so keeping it would report `failed` for a swap the fallback went on to complete. A `success: false` envelope takes step 2 as well — that is the wire contract's "no record found", whatever `data` carries. A transport or server error routes on too, so a transient backend outage does not fail a swap the solver can still report on.

**One failure does not route on: a rejected API key.** The swaps apiguard covers `POST /swaps/*`, so this `GET` does not normally see a 401/403 — unlike the bridge sibling, where the apiguard reads every `/bridge/*` route. Wherever one does arrive, it is a terminal configuration problem rather than a source that had nothing to say. Degrading to the solver would bury it behind a relay or solver error and leave a poller retrying a request only a corrected key can satisfy, so it surfaces directly, with `context.status` set for `isAuthFailure`. The transient key-verification `503` is not this case: it routes on like any other outage.

Both payloads are already documented — the submit-tx record in [SWAPS_API.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS_API.md), the solver response under [Get Intent Status](#get-intent-status). Nothing is translated between them, so no field is dropped and no status code is reinterpreted.

### When it fails

`LOOKUP_FAILED`, and only that. It means no source could answer — most often the relay has not delivered the packet, so there is no hub tx hash for the solver to be asked about. That is a miss, not a lifecycle step: the method will not invent an early status, and it will not fall back to a stale abandoned record.

If you poll this yourself, branch on `error.context.reason`. It equals `DETAILED_STATUS_NOT_DELIVERED` when the backend answered (a record, or a definitive 404) **and** the relay has no packet for the source tx — whether it answers 404 for a tx it has not indexed, or returns no matching delivered packet. You cannot tell that apart from "still in flight", so bound it with a retry budget. Any other `LOOKUP_FAILED` is a dependency failing right now — relay 5xx or unreachable, malformed response, solver down, or a backend outage that left the relay miss unprovable. Keep retrying those, since retrying is how the read recovers. A rejected key is the exception: `isAuthFailure(error)` is true and no budget applies, because only a corrected key changes the answer — and none would ever be spent, since an unanswered backend leaves the relay miss untagged. `useDetailedStatus` applies exactly this split.

Because it is meant to be polled, each dependency read it makes — the relay packet lookup and the solver status call —
carries its own budget and gives up rather than hanging. An expiry lands in that second group: it is a dependency
failing right now, so it stays retryable and does not consume a not-delivered budget.

## Get Solved Intent Packet

Poll the relayer until the solver's fill tx has been delivered to the destination chain. Call this after `getStatus` returns `SolverIntentStatusCode.SOLVED`.

```typescript
import { Sodax, ChainKeys, SolverIntentStatusCode } from '@sodax/sdk';
import type { PacketData } from '@sodax/sdk';

const statusResult = await sodax.swaps.getStatus({ intent_tx_hash: hubTxHash });

if (statusResult.ok && statusResult.value.status === SolverIntentStatusCode.SOLVED) {
  const { fill_tx_hash } = statusResult.value;

  if (fill_tx_hash) {
    const packetResult = await sodax.swaps.getSolvedIntentPacket({
      chainId: ChainKeys.ARBITRUM_MAINNET, // destination spoke chain key
      fillTxHash: fill_tx_hash,
      timeout: 120_000, // optional, default: 120 s
    });

    if (packetResult.ok) {
      const packet: PacketData = packetResult.value;
      console.log('Dst chain tx hash:', packet.dst_tx_hash);
      console.log('Status:', packet.status);
    } else {
      // packetResult.error is a plain Error from the relay layer (this method does NOT
      // adopt the SodaxError shape). error.message === 'RELAY_TIMEOUT' if the packet
      // didn't arrive in time. Discriminate via RELAY_ERROR_CODES.
      console.error('Packet not delivered:', packetResult.error);
    }
  }
}
```

---

## Get Intent Hash

Compute the keccak256 hash of an intent (its unique ID on the hub chain).

```typescript
import type { Intent, Hex } from '@sodax/sdk';

const intentHash: Hex = sodax.swaps.getIntentHash(intent);
console.log('Intent hash:', intentHash);
```

---

## Error Handling Examples

The full reference is in **[Error Handling](#error-handling)** above. The examples below show the common discrimination patterns end-to-end.

### Handling `swap` / `createLimitOrder` Errors

These methods perform multiple operations in sequence. On failure, `result.error` is a `SodaxError<SwapErrorCode>` — discriminate on `result.error.code`:

```typescript
import { isSodaxError } from '@sodax/sdk';

const swapResult = await sodax.swaps.swap({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});

if (!swapResult.ok) {
  const error = swapResult.error; // SwapError = SodaxError<SwapErrorCode>

  switch (error.code) {
    case 'USER_REJECTED':
      // User cancelled the wallet prompt. Not a failure — reset the UI, don't show an error.
      break;

    case 'EXECUTION_FAILED':
      // Solver notification failed — the intent may have been created and relayed
      // successfully. Check intent status manually, then retry postExecution.
      console.error('Underlying cause:', error.cause);
      break;

    case 'RELAY_TIMEOUT':
      // Relay didn't confirm within the timeout. Check intent status; resubmit with longer timeout.
      console.error('Underlying cause:', error.cause);
      break;

    case 'TX_SUBMIT_FAILED':
      // CRITICAL: spoke tx landed but relay submission failed.
      // Store spokeTxHash + submitPayload in local storage and retry promptly.
      console.error('Underlying cause:', error.cause);
      break;

    case 'RELAY_FAILED':
      // Other relay failure. error.context.relayCode disambiguates:
      //   'RELAY_POLLING_FAILED' — polling endpoint outage; query the hub directly.
      //   'UNKNOWN'              — forward-compat fallback for new relay error codes.
      break;

    case 'TX_VERIFICATION_FAILED':
      // Spoke tx could not be verified.
      break;

    case 'INTENT_CREATION_FAILED':
      // Spoke deposit / intent creation failed.
      break;

    case 'VALIDATION_FAILED':
      // Precondition failure — human-readable prose in error.message; details in error.context.
      console.error('Bad input:', error.message);
      break;

    case 'EXTERNAL_API_ERROR':
      // Solver returned a typed error. error.context.solverCode is the SolverIntentErrorCode.
      console.error('Solver code:', error.context?.solverCode);
      break;

    case 'UNKNOWN':
      console.error('Unexpected:', error.cause);
      break;
  }
}
```

### Handling `createIntent` Errors

`createIntent` returns `Result<CreateIntentResult, SwapCreateIntentError>`. The narrow union is `'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'`:

```typescript
const createIntentResult = await sodax.swaps.createIntent({
  params: createIntentParams,
  walletProvider: evmWalletProvider,
});

if (!createIntentResult.ok) {
  const error = createIntentResult.error;
  switch (error.code) {
    case 'USER_REJECTED':
      // User cancelled the wallet prompt. Not a failure — reset the UI, don't show an error.
      break;
    case 'VALIDATION_FAILED':
      // Unsupported token / invalid chain key / Bitcoin dust below 546 sats / wallet provider mismatch
      console.error('Validation failed:', error.message);
      break;
    case 'INTENT_CREATION_FAILED':
      // Spoke deposit failed (insufficient balance, network issues, simulation failure).
      console.error('Intent creation failed:', error.cause);
      break;
    case 'UNKNOWN':
      console.error('Unexpected:', error.cause);
      break;
    default:
      // Keeps the switch honest if the union gains a code in a future release.
      console.error('Unhandled createIntent code:', error.code);
  }
}
```

### Solver API Errors

`postExecution` errors are wrapped as `SodaxError<PostExecutionErrorCode>` (`EXECUTION_FAILED | EXTERNAL_API_ERROR | UNKNOWN`). The original `SolverErrorResponse.detail` is preserved on `error.context.solverDetail`:

```typescript
import { SolverIntentErrorCode } from '@sodax/sdk';

const postExecResult = await sodax.swaps.postExecution({ intent_tx_hash: hubTxHash });
if (!postExecResult.ok && postExecResult.error.code === 'EXTERNAL_API_ERROR') {
  const solverCode = postExecResult.error.context?.solverCode as SolverIntentErrorCode | undefined;
  if (solverCode === SolverIntentErrorCode.QUOTE_EXPIRED) {
    // refresh quote and retry
  }
}
```

`getQuote` and `getStatus` **retain the legacy error shape in this release** — they still return `Result<T, SolverErrorResponse>`:

```typescript
import { SolverIntentErrorCode } from '@sodax/sdk';
import type { SolverErrorResponse } from '@sodax/sdk';

const quoteResult = await sodax.swaps.getQuote(quoteRequest);
if (!quoteResult.ok) {
  const solverError = quoteResult.error as SolverErrorResponse;
  console.error('Solver error code:', solverError.detail.code);    // SolverIntentErrorCode
  console.error('Solver error message:', solverError.detail.message);
}
```
