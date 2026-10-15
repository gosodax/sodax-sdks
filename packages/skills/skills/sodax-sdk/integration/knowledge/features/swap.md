# Swap — `SwapService`

Intent-based swaps via a solver. Cross-chain by default.

Access: `sodax.swaps`. Service class: `SwapService`. Feature tag for errors: `'swap'`.

## How it works

1. **Build an intent** — `createIntent` signs a spoke transaction encoding the swap declaration.
2. **Relay to hub** — handled internally; the spoke tx propagates to Sonic.
3. **Solver fulfillment** — an off-chain solver picks up the intent and fills it on the destination chain.
4. **Post-execution settlement** — `postExecution` finalizes the user's side once the solver completes.

Two execution paths:

- **`swap`** — full flow in one call. Wraps `createIntent` + relay + `postExecution`. Returns `SwapResponse` on success. By default uses a **backend-driven 2-step** variant (`swaps.useBackendSubmitTx`, default `true` — the backend relays + post-executes server-side); on any non-success it falls back to the client-side relay, returning the same `SwapResponse`. Set `new Sodax({ swaps: { useBackendSubmitTx: false } })` to force client-side only. The SDK does NOT verify the tx on-chain before handing it to the backend — the backend verifies itself, so `verifyTxHash` (and `TX_VERIFICATION_FAILED`) belong to the client-side path only. `timeout` (defaults to `DEFAULT_RELAY_TX_TIMEOUT`) is a PER-ATTEMPT budget, not end-to-end: the backend attempt (submit POST + status poll) gets it, and if that attempt does not complete the client-side relay wait gets a fresh one starting after verification — so neither a stalled backend nor a slow source-chain confirmation shortens the fallback, and raising `timeout` grows both. Each backend request is clamped to `min(budget left in the attempt, api.timeout)`; `api.timeout` is configurable (packaged default `DEFAULT_BACKEND_API_TIMEOUT`), and once the attempt's remainder drops below it a single stalled request can spend what is left — the clamp bounds a request by the attempt, it does not guarantee a retry. Worst case is `createIntent + timeout + verification + max(timeout, RELAY_FALLBACK_FLOOR_MS) + postExecution`; verification is bounded by the source chain's `pollingConfig.maxTimeoutMs` (varies widely — Stacks is several times Sui — read `chains.ts`, and it is a no-op on EVM), and intent creation and post-execution are not bounded by `timeout` at all.
- **`createIntent` + backend submit** — break it apart for custom relay handling. `createIntent` returns `{ tx, intent, relayData }`; submit `relayData.payload` to the backend swap-tx endpoint via `sodax.api.swaps.submitTx`.

## Public methods

```ts
sodax.swaps.swap<K extends SpokeChainKey>(action: SwapActionParams<K, false>): Promise<Result<SwapResponse, SodaxError>>;

sodax.swaps.getQuote(payload: GetQuoteParams): Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>>;
//   GetQuoteParams = SolverIntentQuoteRequest & { partnerFee?: PartnerFee } — pass the request as before;
//   optionally add `partnerFee` to override the configured swap fee for this quote (matches extras.partnerFee).
//   Preview the output amount before signing — useful for UX confirmations / bot previews.

sodax.swaps.createIntent<K extends SpokeChainKey, Raw extends boolean>(
  action: SwapActionParams<K, Raw>,
): Promise<Result<CreateIntentResult<K, Raw>, SodaxError>>;

sodax.swaps.postExecution(
  args: { intent, relayData },
): Promise<Result<SwapResponse, SodaxError>>;

sodax.swaps.createLimitOrder<K, Raw>(
  action: LimitOrderActionParams<K, Raw>,
): Promise<Result<CreateIntentResult<K, Raw>, SodaxError>>;

sodax.swaps.createLimitOrderIntent<K, Raw>(/* same as createIntent shape with limit-order params */): /* same return */;

sodax.swaps.cancelIntent<K>(/* … */): Promise<Result<TxHashPair, SodaxError>>;        // not generic over Raw (only false)
sodax.swaps.cancelLimitOrder<K>(/* … */): Promise<Result<TxHashPair, SodaxError>>;    // TxHashPair = { srcChainTxHash, dstChainTxHash }
sodax.swaps.getCancelIntentRelayData(intent: Intent): Result<RelayExtraData>;      // `data` for manually relaying a Solana cancel tx

sodax.swaps.approve<K, Raw>(/* … */): Promise<Result<TxReturnType<K, Raw>, SodaxError>>;
sodax.swaps.isAllowanceValid<K, Raw>(/* … */): Promise<Result<boolean, SodaxError>>;

sodax.swaps.swapWithApproval<K extends SpokeChainKey>(
  action: SwapActionParams<K, false>,
): Promise<Result<SwapResponse & { approvalStrategy: SwapApprovalStrategy }, SodaxError>>;
//   `swap` with the approval folded in: no approval when the allowance suffices; approve + deposit as ONE
//   EIP-5792 atomic batch (one signature) on a batch-capable wallet + EVM spoke source; otherwise approve,
//   wait for it to confirm, then swap. Same completion as `swap`. Adds APPROVE_FAILED / ALLOWANCE_CHECK_FAILED.

sodax.swaps.getApprovalStrategy<K extends SpokeChainKey>(
  action: SwapActionParams<K, false>,
): Promise<Result<SwapApprovalStrategy, SodaxError<'ALLOWANCE_CHECK_FAILED'>>>;
//   SwapApprovalStrategy = 'not-required' | 'atomic-batch' | 'sequential' — read-only; use it to label the button.

sodax.swaps.getSwapSpeedTier(params: { srcToken: XToken; dstToken: XToken }): SwapSpeedTierResult;
//   Synchronous, offline, no Result wrapper — estimates settlement speed from SDK config alone
//   (no network / on-chain / backend call). SwapSpeedTierResult = { tier: 'fast'|'normal'|'slow', estimatedSeconds }.
//   A token whose `vault` is a money-market reserve (sodaAsset) settles faster; an Ethereum leg adds a fixed penalty.
//   Safe to call synchronously while rendering a quote (e.g. an ETA badge next to the output amount).

sodax.swaps.getStatus(
  request: SolverIntentStatusRequest,          // { intent_tx_hash } — the HUB (Sonic) tx hash
): Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>>;   // legacy error shape, NOT SodaxError

sodax.swaps.getDetailedStatus(
  params: { srcChainKey: SpokeChainKey; srcTxHash: string },   // the SOURCE-chain tx hash
): Promise<Result<DetailedSwapStatus, SodaxError<'LOOKUP_FAILED'>>>;
//   Routes to the backend submit-tx record or the solver. Does NOT define a new status vocabulary.
```

## Approve and swap in one signature

`swapWithApproval` replaces the `isAllowanceValid` → `approve` → `swap` sequence with one call. It batches only
when the source is an EVM spoke (not the Sonic hub) and the wallet provider implements the optional EIP-5792 methods
(`EvmWalletProvider` does for a connected browser wallet, never for a private-key account) and reports
`'supported'` or `'ready'` for that chain — `'ready'` means the wallet asks the user to upgrade the account (MetaMask:
EIP-7702 smart account) on the first batch. Everything else takes the two-step path (three signatures for a token
that must reset a stale allowance), so the call is safe on any chain. Pass `allowAccountUpgrade: false` (to both
`getApprovalStrategy` and `swapWithApproval`) to keep a `'ready'` wallet on the two-step path and never show the
upgrade prompt; whether to do so is the app's call.

If the wallet refuses the batch before signing (e.g. EIP-5792 `5760`), the method approves separately on its own and
reports `approvalStrategy: 'sequential'`. Once the user has seen the batch it is never retried as separate
transactions:

- rejected batch → `USER_REJECTED`; a declined upgrade is `USER_REJECTED` with
  `context.reason === ACCOUNT_UPGRADE_DECLINED` — the user refused the smart account, not the swap, so it is fine to
  offer the same swap again with `allowAccountUpgrade: false`;
- batch never included or fully reverted (EIP-5792 `400` / `500`) → `INTENT_CREATION_FAILED` with
  `context.reason: 'atomic-batch-failed'` (nothing deposited);
- anything else short of a confirmed deposit receipt (not confirmed within `timeout`, a partial revert, unclear
  receipts) → `TX_VERIFICATION_FAILED` with `context.reason === ATOMIC_BATCH_UNCONFIRMED`, `context.batchId` and
  `context.callCount`. It may have landed — **never send it again**; call `swapWithApproval` with the same `params`
  and wallet plus `resumeBatchId: context.batchId` and `resumeBatchCallCount: context.callCount`, which only waits
  for that batch and finishes the swap once it lands (the same unconfirmed error while it is still pending).

Do not chain your own `approve` after any of these; that is exactly the double prompt this method avoids.

## Reading swap status

Three readers. Pick by which transaction hash you hold:

- **`sodax.api.swaps.getSubmitTxStatus({ txHash, srcChainKey })`** — the backend worker record, keyed on the **source** tx. Answers **404** when no record exists (`useBackendSubmitTx: false`, or the submit never landed). Otherwise the record may be *stale*: `swap()` submits before falling back to the client-side relay, so a fallback-completed swap leaves a `pending`/`relaying`/abandoned record behind.
- **`sodax.swaps.getStatus({ intent_tx_hash })`** — the solver's view of one intent, keyed on the **hub** tx hash (`intentDeliveryInfo.dstTxHash`). Returns the legacy `SolverErrorResponse` error shape, so do not `switch (error.code)` on it.
- **`sodax.swaps.getDetailedStatus({ srcChainKey, srcTxHash })`** — routes between the two, keyed on the **source** tx. Use this when you only have the source hash and do not know which path the swap took.

`getDetailedStatus` defines no status of its own. It returns whichever source can answer, tagged, with that source's payload unmodified. The union is discriminated on `source` — no type guards are exported, narrow on the field:

```ts
type DetailedSwapStatus =
  | { source: 'backend'; data: SubmitTxStatusDataV2 }         // same as getSubmitTxStatus
  | { source: 'solver'; dstTxHash: Hex; data: SolverIntentStatusResponse }; // same as getStatus

if (status.source === 'backend') status.data.processingAttempts;
```

Routing: backend record while it is in play (`success: true` and not abandoned) → `source: 'backend'`. **Any** unusable backend response — 404, `success: false`, transport/server error, or a record the backend gave up on (`failed` or `abandonedAt`) — resolves the hub tx hash and asks the solver → `source: 'solver'`. On the default path the abandoned-record branch is the common one, not the 404: the record usually exists, and abandonment is what signals the client-side fallback ran.

To render it without switching on `source`, collapse it with the pure `summarizeSwapStatus` (exported from `@sodax/sdk`):

```ts
const { state, hubTxHash, fillTxHash } = summarizeSwapStatus(status); // state: 'pending' | 'solved' | 'failed'
```

`fillTxHash` may be absent even when solved (the backend can confirm a fill from the on-chain journal without one).

**A `swap()` failure after broadcast still carries the source tx.** `TX_VERIFICATION_FAILED`, the relay codes and postExecution failures set `error.context.srcTxHash` (plus `srcChainKey`). The swap may still complete — the backend keeps working after `swap()` gives up — so keep polling `getDetailedStatus` with it instead of reporting the swap as lost. One case polling cannot fix: a failed solver notification (`EXECUTION_FAILED` / `EXTERNAL_API_ERROR`, `phase: 'postExecution'`) also sets `error.context.dstTxHash`, the hub tx. Unless the backend took the swap nothing else notifies the solver and the intent expires, so call `postExecution({ intent_tx_hash: dstTxHash })` again (the solver only re-affirms an intent it already has), then poll.

The only error is `LOOKUP_FAILED`, meaning no source could answer — usually the relay has not delivered the packet, so there is no hub tx hash. When polling, branch on `error.context.reason`: `DETAILED_STATUS_NOT_DELIVERED` is the ambiguous miss (indistinguishable from "still in flight" — bound it with a retry budget), set only when the backend also answered. Anything else, including a relay miss behind a backend outage, is a dependency failing right now and should be retried until it recovers. A 401/403 from the backend does not route on at all — it surfaces directly with `context.status` lifted, so `isAuthFailure(error)` is true and polling should stop; only a corrected key changes the answer. Point-in-time — poll it yourself, or use dapp-kit's `useDetailedStatus`.

## Action params shape

Generic `K extends SpokeChainKey` carries the literal source chain key. `WalletProviderSlot<K, Raw>` is intersected:

```ts
type SwapActionParams<K extends SpokeChainKey, Raw extends boolean> = {
  params: CreateIntentParams<K>;
  extras?: SwapExtras<K>;    // per-action overrides (optional)
  skipSimulation?: boolean;
  timeout?: number;
} & WalletProviderSlot<K, Raw>;
```

`extras` and every field on it are optional. `partnerFee` overrides the configured swap fee for this single action (the same override `getQuote` accepts, below); `apiKey` overrides the configured backend API key (`new Sodax({ apiKey })`) for this action's backend submit-tx leg, sent as the `x-api-key` header; `srcPublicKey` is chain-key-gated — only typeable when `K` is a Stacks chain (`never` elsewhere) and only needed for raw (`raw: true`) Stacks `createIntent`; `bound` is chain-key-gated to Bitcoin and groups the Bound Exchange (Radfi) inputs — its `accessToken` is only needed for raw Bitcoin TRADING-mode `createIntent`, overriding the RadfiProvider's configured token and falling back to that instance token when omitted. (Grouping keeps future Bound inputs — trading mode, refresh token — under one slot rather than spreading a new `extras` field per item.) `LimitOrderActionParams<K, Raw>` carries the same `SwapExtras<K>`.

```ts
type SwapExtras<K extends SpokeChainKey> = {
  partnerFee?: PartnerFee;        // overrides the configured swap fee for this action; falls back to config
  apiKey?: string;                // overrides the configured backend API key (x-api-key) for this action's backend submit-tx leg
  srcPublicKey?: string;          // Stacks only (raw createIntent): signer public key. Chain-key-gated — `never` on non-Stacks K.
  bound?: BitcoinBoundExtras;     // Bitcoin only: grouped Bound Exchange (Radfi) inputs. Chain-key-gated — `never` on non-Bitcoin K.
};

type BitcoinBoundExtras = {
  accessToken?: string;           // raw TRADING createIntent: Bound Exchange token; falls back to the RadfiProvider instance token.
};
```

`CreateIntentParams<K>`:

```ts
type CreateIntentParams<K extends SpokeChainKey> = {
  srcChainKey: K;
  dstChainKey: SpokeChainKey;
  srcAddress: string;       // source-chain address (chain-specific format)
  dstAddress: string;       // chain-specific format on the destination side
  inputToken: string;       // token ADDRESS on srcChainKey (the XToken's .address)
  outputToken: string;      // token ADDRESS on dstChainKey (the XToken's .address)
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;         // unix seconds
  allowPartialFill: boolean;
  solver?: `0x${string}`;   // optional solver address; '0x0…0' for default
  data: `0x${string}`;      // arbitrary calldata; '0x' for default
  hook?: HookRequest;       // route the output through a registered delivery hook — see below
  deliveryData?: `0x${string}`;  // low-level delivery payload; escape hatch, ignored when `hook` is set
};
```

`CreateLimitOrderParams<K>` is `Omit<CreateIntentParams<K>, 'deadline'> & { deadline?: bigint }` — it makes `deadline` optional rather than removing it; when omitted the SDK forces it to `0n` internally (limit orders use a different expiry mechanism).

### Delivery hooks (`hook` / `deliveryData`)

By default an intent's output is transferred straight to `dstAddress`. A **delivery hook** instead hands
it to a contract on the destination spoke that acts on the recipient's behalf — `SpokeAssetManager` calls
`ISpokeReceiver(dstAddress).hook(token, amount, deliveryData)`.

Prefer `hook` over `deliveryData`: the SDK resolves the hook's deployed address and encodes its payload
from the registry (`spokeHooks` in `@sodax/types`), so the two can never drift.

```ts
import { HookKind, getSpokeHook } from '@sodax/sdk';

// Which kinds exist, and on which chains, is registry data that grows — discover, don't hardcode.
const kind = HookKind.HYPERCORE_DEPOSIT;        // any registered kind; see `HookKind` for the current set
if (!getSpokeHook(dstChainKey, kind)) return;   // not deployed there → send a plain transfer instead

const params = {
  // …the usual CreateIntentParams fields…
  dstAddress: recipient,  // the account the hook CREDITS — the SDK overwrites the on-chain
                          // dstAddress with the hook's own address
  hook: { kind },
};
```

- **Fails closed** — a kind not registered on `dstChainKey` throws at intent-construction time, before an
  intent exists. A zero-address recipient is rejected for every hook (it would revert on arrival and
  wedge the cross-chain message unrecoverably).
- **Best-effort on-chain** — a hook generally delivers plain tokens to the recipient rather than
  reverting when it can't act (unsupported token, refusing target, amount below its minimum). Treat a
  hooked intent as "the tokens arrive; the hook action may not". `supportedTokens` on a registry entry
  describes that on-chain behaviour; the SDK does not reject a mismatched `outputToken` client-side.
- `deliveryData` is the escape hatch for a receiver **not** in the registry: opaque bytes whose schema the
  receiver defines, and you point `dstAddress` at that receiver yourself. Ignored when `hook` is set.

## Common call shapes

### Quote before signing (preview / confirmation UX)

`getQuote` is a read-only call to the solver — no wallet, no signing. Use it for trading-bot previews, UI confirmations, or to set `minOutputAmount` based on a fresh quote.

```ts
const quote = await sodax.swaps.getQuote({
  token_src: USDC_ARBITRUM.address,
  token_src_blockchain_id: ChainKeys.ARBITRUM_MAINNET,
  token_dst: XLM.address,
  token_dst_blockchain_id: ChainKeys.STELLAR_MAINNET,
  amount: 1_000_000n,        // 1 USDC (6 decimals)
  quote_type: 'exact_input', // currently the only supported type
});

if (!quote.ok) {
  // quote.error: SolverErrorResponse — different shape from SodaxError;
  // see `error.detail.code` and `error.detail.message`.
  return;
}

const { quoted_amount } = quote.value;   // bigint output amount in dst-token units
// Use `quoted_amount` (with a slippage buffer) as `minOutputAmount` on the swap call.
```

`SolverIntentQuoteRequest` uses snake_case fields and **`token_src`/`token_dst` are token addresses** (strings), not full `XToken` objects. `quote_type` is currently `'exact_input'` only.

### Signed swap (full flow)

`inputToken` / `outputToken` on `CreateIntentParams` are token **addresses** (`string`), not `XToken` objects. Look the `XToken` up from config (do **not** hand-construct) and pass its `.address` — the looked-up object also gives you `decimals` for `parseUnits`:

```ts
const inputToken  = sodax.config.findSupportedTokenBySymbol(ChainKeys.ARBITRUM_MAINNET, 'USDC');
const outputToken = sodax.config.findSupportedTokenBySymbol(ChainKeys.STELLAR_MAINNET,  'XLM');
if (!inputToken || !outputToken) throw new Error('Token missing from config — did you call sodax.config.initialize()?');

const result = await sodax.swaps.swap({
  params: {
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    srcAddress: '0x…',
    dstAddress: 'G…',
    inputToken: inputToken.address,                 // token ADDRESS on srcChainKey
    outputToken: outputToken.address,               // token ADDRESS on dstChainKey
    inputAmount: parseUnits('1', inputToken.decimals),   // 1 USDC
    minOutputAmount: parseUnits('50', outputToken.decimals), // 50 XLM floor
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    allowPartialFill: false,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  raw: false,
  walletProvider: evmWp,
});

if (!result.ok) return;
const { solverExecutionResponse, intent, intentDeliveryInfo } = result.value;
// SwapResponse: { solverExecutionResponse, intent, intentDeliveryInfo }
// Use `intentDeliveryInfo` for spoke / hub tx hashes; `solverExecutionResponse` for solver-side outcome.
```

### Hub as source (Sonic → spoke)

`srcChainKey` accepts `ChainKeys.SONIC_MAINNET` too — same `WalletProviderSlot<K, Raw>` shape, same `Result<T>` return. The SDK routes through the user's hub-wallet abstraction instead of a spoke deposit. The token lookup pattern is identical; only the chain key changes:

```ts
const sodaSonic = sodax.config.findSupportedTokenBySymbol(ChainKeys.SONIC_MAINNET, 'SODA');
const sodaBase  = sodax.config.findSupportedTokenBySymbol(ChainKeys.BASE_MAINNET,  'SODA');
if (!sodaSonic || !sodaBase) throw new Error('SODA missing from config');

const result = await sodax.swaps.swap({
  params: {
    srcChainKey: ChainKeys.SONIC_MAINNET,
    dstChainKey: ChainKeys.BASE_MAINNET,
    srcAddress: (await evmWp.getWalletAddress()) as `0x${string}`,
    dstAddress: recipientOnBase,
    inputToken: sodaSonic.address,
    outputToken: sodaBase.address,
    inputAmount: parseUnits('1', sodaSonic.decimals),
    minOutputAmount: parseUnits('0.99', sodaBase.decimals),   // tighten with getQuote() in production
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    allowPartialFill: false,
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  raw: false,
  walletProvider: evmWp,
});
```

If both `srcChainKey` and `dstChainKey` are spoke chains that share a vault for the token, prefer [`sodax.bridge.bridge`](bridge.md) — it skips the solver and tends to be cheaper. Use `swap` when no vault pair exists or when a solver-routed price improves the outcome.

### Create intent only (custom relay)

```ts
const result = await sodax.swaps.createIntent({
  params: { /* … */ },
  raw: false,
  walletProvider: evmWp,
});
if (!result.ok) return;

const { tx: spokeTxHash, intent, relayData } = result.value;
//   tx is the spoke tx hash (TxReturnType<K, false>) for raw: false
//   relayData is { address: Hex; payload: Hex }; submit relayData.payload to your backend
```

### Backend submit-tx flow

Submitting is only the first half. `swap()` also polls to a terminal status and falls back to the client-side relay on any non-success — code that drives the steps itself must do both. Full recipe: [`../recipes/manual-submit-tx-with-fallback.md`](../recipes/manual-submit-tx-with-fallback.md).

```ts
const submitResult = await sodax.api.swaps.submitTx({
  txHash: spokeTxHash as string,
  srcChainKey: ChainKeys.ARBITRUM_MAINNET,
  walletAddress: '0x…',           // the SOURCE address that signed
  intent,                         // IntentRequestV2 — CreateIntentResult.value.intent passes through
  relayData: relayData.payload,   // string (not the object)
});

// Two distinct failure arms — the reason lives in a different place on each.
if (!submitResult.ok) {
  // Transport / HTTP / validation: submitResult.error.code is 'EXTERNAL_API_ERROR'
  // with context.api: 'swaps'. There is no `value`.
  return fallbackToClientSideRelay();
}
if (!submitResult.value.success) {
  // 200, but the backend did NOT queue it. There is no `error` here — the reason is
  // on the payload: submitResult.value.data.message.
  return fallbackToClientSideRelay();
}

// Then poll `sodax.api.swaps.getSubmitTxStatus({ txHash, srcChainKey })`:
//   status 'solved' AND result.dstIntentTxHash AND result.intent_hash → done
//   status 'failed', or `abandonedAt` set                             → terminal, fall back
//   401/403 (isAuthFailure)                                           → stop polling, fall back
//   pending | relaying | relayed | posting_execution | posted_execution → keep polling
//   budget exhausted                                                  → fall back
```

Do NOT call `verifyTxHash` before submitting — the backend verifies itself, so a client-side confirmation wait only delays every backend success. Verification belongs to the fallback path. The fallback relay also needs its own FRESH timeout, never the remainder of the backend attempt's.

### Raw-tx flow

```ts
const result = await sodax.swaps.createIntent({
  params: { /* … */ },
  raw: true,
  // walletProvider is forbidden here
});
if (!result.ok) return;
const { tx, intent, relayData } = result.value;
// tx: chain-specific raw-tx payload (EvmRawTransaction, SolanaRawTransaction, …)
```

### Cancel intent

```ts
await sodax.swaps.cancelIntent({
  params: { srcChainKey, intent /* the full Intent struct */ },
  raw: false,
  walletProvider: evmWp,
});
```

Relay handling is chain-aware and needs no caller input: Solana cancels submit the cancel payload with the spoke tx, Bitcoin cancels relay the signed on-demand payload. On Bitcoin `srcChainTxHash` is the relay's `od:<hash>` id, not a chain tx hash.

`params.srcAddress` (optional) overrides the wallet the cancel is sent from; it defaults to the intent's `srcAddress`, or on Bitcoin TRADING mode to `walletProvider.getWalletAddress()` (the intent stores the trading address). A raw (`raw: true`) Bitcoin TRADING-mode cancel must pass it.

Relaying a `createCancelIntent` tx yourself: on Solana pass `data: sodax.swaps.getCancelIntentRelayData(intent).value` to `submitIntent` (the create-intent extra data does not match a cancel tx); on Bitcoin the returned value is the signed on-demand payload JSON — relay it via `sodax.spoke.bitcoin.getOnDemandRelayIdentity(json)` (`srcTxHash: 'withdraw'`, `data`, `pollTxHash`).

## Return shapes

| Method | Success type |
|---|---|
| `swap` | `SwapResponse` = `{ solverExecutionResponse, intent, intentDeliveryInfo }` |
| `createIntent` | `CreateIntentResult<K, Raw>` = `{ tx: TxReturnType<K, Raw>, intent: Intent & FeeAmount, relayData: RelayExtraData }` |
| `postExecution` | `SwapResponse` |
| `createLimitOrder` / `createLimitOrderIntent` | Same as `createIntent` |
| `cancelIntent` / `cancelLimitOrder` | `TxHashPair` = `{ srcChainTxHash, dstChainTxHash }` (not generic over `Raw`) |
| `approve` | `TxReturnType<K, Raw>` |
| `isAllowanceValid` | `boolean` |
| `getSwapSpeedTier` | `SwapSpeedTierResult` = `{ tier: 'fast' \| 'normal' \| 'slow', estimatedSeconds: number }` (synchronous, not a `Result`) |

`RelayExtraData`:

```ts
type RelayExtraData = {
  address: Hex;        // relay address
  payload: Hex;        // pass this to backend submit-tx as `relayData`
};
```

`approve` can send **two** transactions on a token that rejects a non-zero to non-zero allowance
change (Ethereum USDT is the only listed one today): `approve(0)` is mined first, then the real
approval, so the user signs twice. The returned value is unchanged — one hash, the **last**
transaction's. Detection simulates the approval, so never gate on a token list. Full note: "ERC-20
approval can take two transactions" in [`architecture.md`](../architecture.md).

## Error codes

`feature: 'swap'`. Per-method narrow unions:

| Method | Codes |
|---|---|
| `createIntent`, `createLimitOrderIntent` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `UNKNOWN` |
| `swap`, `createLimitOrder` | `VALIDATION_FAILED`, `INTENT_CREATION_FAILED`, `EXECUTION_FAILED`, `TX_VERIFICATION_FAILED`, `TX_SUBMIT_FAILED`, `RELAY_TIMEOUT`, `RELAY_FAILED`, `EXTERNAL_API_ERROR`, `UNKNOWN` |
| `postExecution` | `EXECUTION_FAILED` (with `phase: 'postExecution'`), `EXTERNAL_API_ERROR` (with `api: 'solver'`), `UNKNOWN` |
| `cancelIntent`, `cancelLimitOrder` | `VALIDATION_FAILED`, `EXECUTION_FAILED`, `UNKNOWN` |
| `approve` | `VALIDATION_FAILED`, `APPROVE_FAILED`, `UNKNOWN` |
| `isAllowanceValid` | `VALIDATION_FAILED`, `ALLOWANCE_CHECK_FAILED`, `UNKNOWN` |

Solver-specific context on `EXTERNAL_API_ERROR`:

- `error.context.api === 'solver'`
- `error.context.solverCode` — the solver's own error code as a **numeric** `SolverIntentErrorCode` enum value (e.g. `-5` = `NO_PRIVATE_LIQUIDITY`, `-999` = `UNKNOWN`), not a string
- `error.context.solverDetail` — the solver's full detail object `{ code, message }`

## Cross-references

- Driving the steps yourself (backend submit-tx + fallback): [`../recipes/manual-submit-tx-with-fallback.md`](../recipes/manual-submit-tx-with-fallback.md).
- v1 → v2 swap migration: [`features/swap.md`](../../../migration-v1-to-v2/knowledge/features/swap.md).
- Error model: [`../architecture.md`](../architecture.md) § 8 and [`../reference/`](../reference/) § 3.
- Stellar destinations require a trustline first: [`../chain-specifics.md`](../chain-specifics.md) § "Stellar trustline".
- NEAR destinations require NEP-141 storage registration first: [`../chain-specifics.md`](../chain-specifics.md) § "Receiving tokens: NEP-141 storage registration".
