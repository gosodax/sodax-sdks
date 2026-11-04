// Backend Swaps API v2 — request/response contract types.
//
// One type per request/response of every endpoint in the backend `swaps-api`
// controller (`apps/swaps-api/src/api/swaps/swaps.controller.ts`). They favor
// plain primitives (`string`/`number`/`boolean`/`bigint`/plain objects) over SDK
// branded types.
//
// Inbound (request) and outbound (response) shapes are SEPARATE types because the
// two directions genuinely differ:
// - Outbound (response) types are pure JSON: every bigint-derived value (intent
//   ids, amounts, deadlines, fees, relay chain ids) is a decimal `string`, and
//   every `Date` is an ISO 8601 `string` (e.g. `abandonedAt`). A response NEVER
//   contains `bigint` on the wire — JSON cannot represent it (the one typed
//   exception is the unsigned `tx`; see below).
// - Inbound (request) types mirror the server's parsed request DTOs: the Intent
//   struct (`IntentRequestV2`) carries `bigint` for its numeric fields, matching
//   the backend `IntentDto`. Other request fields (amounts/deadlines on
//   `CreateIntentParamsV2`/`QuoteRequestV2`, fees, relay chain ids, etc.) are
//   decimal `string`, matching their `@IsNumberString` DTO fields.
// - `Hex` / `Address` / `Hash` / `SpokeChainKey` are plain `string` everywhere.
// - The unsigned `tx` is typed as the SDK domain union `RawTxReturnType`. It
//   travels as pure JSON (bigints stringified; Injective byte arrays as
//   `{ "0": N, … }` index objects), and the wire clients' response schemas
//   (the `rawTxSchemas` module in `@sodax/swaps-api` / `@sodax/bridge-api`)
//   rebuild the domain shape (`bigint`, `Uint8Array`) on parse — the inverse
//   of the backend's `stringifyBigInts`.
// - The remaining chain-specific opaque payloads (gas estimate, raw relay
//   `result`) stay `unknown` because their shape varies by chain family.
//
// Shapes used in both directions are split into a `*RequestV2` (client → server)
// and a `*ResponseV2` (server → client) interface. `IntentRequestV2` (bigint
// numerics) and `IntentResponseV2` (all-string) genuinely differ;
// `RelayExtraDataRequestV2` / `RelayExtraDataResponseV2` are identical (no bigint
// fields). This mirrors the backend's request/response DTO pairs.
//
// The Config API v2 section at the bottom of this file takes a DIFFERENT approach
// (see its header): it REUSES the canonical `@sodax/types` config types and projects
// only the few bigint fields to `string`, rather than re-declaring a parallel tree.

import type { SpokeChainConfig } from '../chains/chains.js';
import type { XToken } from '../chains/tokens.js';
import type { RelayConfig } from '../common/constants.js';
import type { ConcentratedLiquidityConfig, DexDefaultConfig } from '../dex/dex.js';
import type { SodaxDefaultConfig } from '../sodax-config/sodax-config.js';

import type { RawTxReturnType } from '../common/index.js';
import type { HookKind } from '../hooks/hooks.js';

// ──────────────────────────────────────────────────────────────────────
// Shared building blocks
// ──────────────────────────────────────────────────────────────────────

/** Quote direction. Only exact-input quoting is supported. */
export type QuoteTypeV2 = 'exact_input';

/**
 * JSON-safe partner fee for swap requests. Wire mirror of the SDK `PartnerFee` union, with the
 * bigint `amount` projected to a decimal `string`. `address` is the EVM hub fee receiver; provide
 * either a fixed `amount` (input token's smallest unit, decimal string) or a `percentage` (basis
 * points, e.g. 100 = 1%). If both are present the backend uses `amount`, matching the SDK.
 */
export type PartnerFeeV2 = { address: string; amount: string } | { address: string; percentage: number };

/** JSON-safe mirror of the SDK `BitcoinBoundExtras` — Bound Exchange (Radfi) inputs for raw Bitcoin TRADING-mode intents. */
export interface BitcoinBoundExtrasV2 {
  /**
   * Bound Exchange (Radfi) access token; threads through the typed DTO instead of an
   * `x-bound-access-token` header. Only consumed for raw Bitcoin TRADING-mode intents.
   */
  accessToken?: string;
}

/**
 * JSON-safe mirror of the SDK `SwapExtras<K>` — per-request swap extras flattened onto a request body.
 * All fields are optional; chain applicability is documented per field (the wire DTO can't `K`-gate the
 * way the SDK type does). Shared by {@link CreateIntentParamsV2} and {@link QuoteRequestV2}.
 */
export interface SwapExtrasV2 {
  /**
   * No default on `/swaps/*` — omit and the swap charges nothing. SDK `fee` / `swaps.partnerFee` does not apply here.
   */
  partnerFee?: PartnerFeeV2;
  /**
   * Source-chain signer public key (compressed hex), for chains whose address can't yield it (e.g.
   * Stacks). Only used when building a raw intent.
   */
  srcPublicKey?: string;
  /**
   * Bitcoin Bound (Radfi) inputs, grouped so future Bound fields extend one slot instead of adding a
   * top-level field per item. Only used for raw Bitcoin TRADING-mode intents.
   */
  bound?: BitcoinBoundExtrasV2;
  /**
   * Route the intent's output through a registered delivery hook instead of transferring it to
   * `dstAddress`. The backend resolves the hook's deployed address (from its pinned SDK's
   * `spokeHooks` registry in `@sodax/types`) and encodes its payload, so `dstAddress` stays the
   * recipient the hook credits, not the delivery target. Omit for a plain transfer.
   *
   * Only used when building an intent: `createIntent`/`createLimitOrderIntent`, or `getQuote` with
   * `includeTxData=true` — a bare quote never builds one, so `hook` is a no-op there without it.
   * `checkAllowance`/`approve` inherit the field too (both extend {@link CreateIntentParamsV2}) but
   * ignore it, same as `partnerFee`: allowance-checking and approval are source-side only and never
   * touch `dstAddress`. Look the registry entry up by *this request's own* destination-chain field,
   * which is **not** spelled the same way on every DTO: `dstChainKey` on
   * {@link CreateIntentParamsV2}/`CreateLimitOrderParamsV2`, but `tokenDstChainKey` on
   * {@link QuoteRequestV2}.
   *
   * The `deliveryData` payload is a per-`HookKind` ABI encoding (see the SDK's `HookService` /
   * `HOOK_DELIVERY_ABI`) — today every registered kind (`hyperCoreDeposit`, `flintDeposit`) encodes
   * `abi.encode(address recipient)`, but that shape is not guaranteed to stay uniform as new kinds
   * are added, so don't hardcode one shared ABI across kinds.
   *
   * A registry entry's `supportedTokens` describes the hook's own on-chain fallback behaviour (which
   * output tokens it actually acts on, vs. passes through as a plain transfer) — it's metadata, not
   * a constraint for the backend to enforce; don't reject a mismatched `outputToken` server-side
   * because of it.
   *
   * Requires a backend new enough to forward this field, and one whose pinned SDK has the hook
   * registered for the destination chain. An unregistered kind is expected to fail the request
   * rather than silently falling back to a plain transfer — that expectation (like `getQuote`
   * forwarding above) describes what this backend needs to implement, not behavior this repo has
   * observed, since the backend lives outside this monorepo.
   */
  hook?: HookRequestV2;
}
// JSON-safety (no `bigint`) is enforced at compile time by the `_AssertJsonSafe` guard intersected onto
// `CreateLimitOrderParamsV2` below — the swaps-section counterpart to the `GetAllConfigResponseV2` guard.

/**
 * Solver intent status code:
 * -1 NOT_FOUND, 1 NOT_STARTED_YET, 2 STARTED_NOT_FINISHED, 3 SOLVED (terminal), 4 FAILED (terminal).
 */
export type SwapIntentStatusCodeV2 = -1 | 1 | 2 | 3 | 4;

/** A supported swap token descriptor (`XToken` projected to JSON primitives). */
export interface SwapTokenV2 {
  /** Token symbol (e.g. `USDC`). */
  symbol: string;
  /** Token name (e.g. `USD Coin`). */
  name: string;
  /** Token decimals. */
  decimals: number;
  /** Token address on its spoke chain (or hub address for hub tokens). */
  address: string;
  /** SODAX SpokeChainKey identifier (e.g. `0xa4b1.arbitrum`, `solana`). */
  chainKey: string;
  /** Corresponding hub-side asset address on Sonic. */
  hubAsset: string;
  /** Hub vault address that custodies bridged liquidity for this token. */
  vault: string;
}

/**
 * Intent struct (hub representation) the client SENDS in request bodies
 * (`/swaps/intents/cancel`, `/swaps/intents/hash`, `/swaps/intents/extra-data`,
 * `/swaps/submit-tx`). Mirrors the backend `IntentDto`: the numeric fields are
 * `bigint`; the transport serializes them to decimal strings on the wire.
 *
 * Differs from {@link IntentResponseV2} (the server-returned variant), whose
 * numeric fields are decimal `string` because outbound JSON cannot carry bigint.
 */
export interface IntentRequestV2 {
  /** Intent ID. */
  intentId: bigint;
  /** Creator address. */
  creator: string;
  /** Input token address (hub asset). */
  inputToken: string;
  /** Output token address (hub asset). */
  outputToken: string;
  /** Input amount in smallest unit. */
  inputAmount: bigint;
  /** Minimum acceptable output amount in smallest unit. */
  minOutputAmount: bigint;
  /** Unix timestamp (seconds) when the intent expires; `0n` for no expiry. */
  deadline: bigint;
  /** Whether partial fills are allowed. */
  allowPartialFill: boolean;
  /** Source intent-relay chain id (e.g. `146n` for Sonic). */
  srcChain: bigint;
  /** Destination intent-relay chain id. */
  dstChain: bigint;
  /** Source address (hex). */
  srcAddress: string;
  /** Destination address (hex). */
  dstAddress: string;
  /** Solver address; the zero address means "any solver". */
  solver: string;
  /** Arbitrary intent calldata (hex). */
  data: string;
}

/**
 * Intent struct (hub representation) the server RETURNS in responses
 * (`POST /swaps/intents`, `GET /swaps/intents/:txHash`). Pure JSON: all
 * bigint-derived fields are decimal strings (outbound JSON cannot carry bigint).
 *
 * Differs from {@link IntentRequestV2} (the client-sent variant), whose numeric
 * fields are `bigint`.
 */
export interface IntentResponseV2 {
  /** Intent ID (decimal string). */
  intentId: string;
  /** Creator address. */
  creator: string;
  /** Input token address (hub asset). */
  inputToken: string;
  /** Output token address (hub asset). */
  outputToken: string;
  /** Input amount in smallest unit (decimal string). */
  inputAmount: string;
  /** Minimum acceptable output amount in smallest unit (decimal string). */
  minOutputAmount: string;
  /** Unix timestamp (seconds) when the intent expires; `"0"` for no expiry (decimal string). */
  deadline: string;
  /** Whether partial fills are allowed. */
  allowPartialFill: boolean;
  /** Source intent-relay chain id (decimal string, e.g. `"146"`). */
  srcChain: string;
  /** Destination intent-relay chain id (decimal string). */
  dstChain: string;
  /** Source address (hex). */
  srcAddress: string;
  /** Destination address (hex). */
  dstAddress: string;
  /** Solver address; the zero address means "any solver". */
  solver: string;
  /** Arbitrary intent calldata (hex). */
  data: string;
}

/**
 * Relay payload the client SENDS to `POST /swaps/intents/submit` (required for
 * Solana / Bitcoin sources). Identical wire shape to {@link RelayExtraDataResponseV2}.
 */
export interface RelayExtraDataRequestV2 {
  /** Relay payload address (hex). */
  address: string;
  /** Relay payload (hex). */
  payload: string;
}

/**
 * Relay payload the server RETURNS from `POST /swaps/intents` (`relayData`) and
 * `POST /swaps/intents/extra-data`. Identical wire shape to {@link RelayExtraDataRequestV2}.
 */
export interface RelayExtraDataResponseV2 {
  /** Relay payload address (hex). */
  address: string;
  /** Relay payload (hex). */
  payload: string;
}

// ──────────────────────────────────────────────────────────────────────
// GET /swaps/tokens · GET /swaps/tokens/:chainKey
// ──────────────────────────────────────────────────────────────────────

/** GET /swaps/tokens — map of SpokeChainKey → supported swap tokens. */
export type GetSwapTokensResponseV2 = Record<string, readonly SwapTokenV2[]>;

/** GET /swaps/tokens/:chainKey — supported swap tokens for a single chain. */
export type GetSwapTokensByChainResponseV2 = readonly SwapTokenV2[];

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/quote
// ──────────────────────────────────────────────────────────────────────

/**
 * POST /swaps/quote — request body. Inherits the swap extras (`partnerFee`, `srcPublicKey`, `bound`,
 * `hook`) from {@link SwapExtrasV2}; the inherited `srcPublicKey`/`bound`/`hook` are consumed only by
 * the `includeTxData=true` intent-building path (Stacks/Bitcoin sources; delivery hooks), mirroring
 * `srcAddress`/`dstAddress` below. Whether a given backend actually forwards `hook` on this endpoint
 * is a deployment question — see `hook`'s own doc comment on {@link SwapExtrasV2}.
 */
export interface QuoteRequestV2 extends SwapExtrasV2 {
  /** Source token address on the source spoke chain. */
  tokenSrc: string;
  /** Source spoke chain key (SODAX SpokeChainKey). */
  tokenSrcChainKey: string;
  /** Destination token address on the destination spoke chain. */
  tokenDst: string;
  /** Destination spoke chain key (SODAX SpokeChainKey). */
  tokenDstChainKey: string;
  /** Input amount in smallest unit of the source token (decimal string). */
  amount: string;
  /** Quote type (only `exact_input` is supported). */
  quoteType: QuoteTypeV2;
  /** Source address — required only when `includeTxData=true` (with the inherited `srcPublicKey`/`bound` for Stacks/Bitcoin sources); ignored otherwise. */
  srcAddress?: string;
  /** Destination address — required only when `includeTxData=true`; ignored otherwise. */
  dstAddress?: string;
}

/** POST /swaps/quote — query params. */
export interface QuoteQueryV2 {
  /** When true, also build and return `{ tx, intent, relayData }` using the quoted amount as `minOutputAmount`. */
  includeTxData?: boolean;
}

/** POST /swaps/quote — response body. */
export interface QuoteResponseV2 {
  /** Quoted output amount in smallest unit of the destination token (decimal string). */
  quotedAmount: string;
  /** Unsigned create-intent transaction; present only when `includeTxData=true`. */
  txData?: CreateIntentResponseV2;
}

// ──────────────────────────────────────────────────────────────────────
// GET /swaps/deadline
// ──────────────────────────────────────────────────────────────────────

/** GET /swaps/deadline — query params. */
export interface DeadlineQueryV2 {
  /** Offset in seconds added to the hub timestamp. Defaults to 300 (5 minutes); minimum 1. */
  offsetSeconds?: number;
}

/** GET /swaps/deadline — response body. */
export interface DeadlineResponseV2 {
  /** Unix timestamp (seconds) at which the swap intent will expire (decimal string). */
  deadline: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/allowance/check · POST /swaps/approve · POST /swaps/intents
// (all three share the CreateIntentParamsV2 request body)
// ──────────────────────────────────────────────────────────────────────

/**
 * Shared request body for `/swaps/allowance/check`, `/swaps/approve`, and `/swaps/intents`. Inherits the
 * swap extras (`partnerFee`, `srcPublicKey`, `bound`, `hook`) from {@link SwapExtrasV2}; the Bitcoin Bound
 * token is carried as `bound.accessToken` (not a flat `accessToken`), mirroring the SDK's grouped
 * `extras.bound`.
 */
export interface CreateIntentParamsV2 extends SwapExtrasV2 {
  /** Source spoke chain key (SODAX SpokeChainKey). */
  srcChainKey: string;
  /** Destination spoke chain key (SODAX SpokeChainKey). */
  dstChainKey: string;
  /** Input token address on the source spoke chain. */
  inputToken: string;
  /** Output token address on the destination spoke chain. */
  outputToken: string;
  /** Input amount in smallest unit of the input token (decimal string). */
  inputAmount: string;
  /** Minimum acceptable output in smallest unit of the output token (decimal string). */
  minOutputAmount: string;
  /** Unix timestamp (seconds) at which the intent expires; `"0"` for limit-order semantics (decimal string). */
  deadline: string;
  /** Whether partial fills are allowed for this intent. */
  allowPartialFill: boolean;
  /** User address on the source spoke chain (chain-specific format). */
  srcAddress: string;
  /** Recipient address on the destination spoke chain (chain-specific format). */
  dstAddress: string;
  /** Solver address (EVM hub address). Defaults to the zero address for "any solver". */
  solver?: string;
  /** Arbitrary calldata hex string. Defaults to `0x`. */
  data?: string;
}

/** Selects a delivery hook by kind. Mirrors the SDK's own `HookRequest`. */
export interface HookRequestV2 {
  kind: HookKind;
}

/** POST /swaps/allowance/check — response body. */
export interface AllowanceCheckResponseV2 {
  /** True when the source token allowance is already sufficient for the intent. */
  valid: boolean;
}

/** POST /swaps/approve — response body. */
export interface ApproveResponseV2 {
  /** Unsigned approval transaction — the `RawTxReturnType` variant for the request's `srcChainKey`. */
  tx: RawTxReturnType;
  /**
   * Present only when the source token rejects an allowance change from one non-zero value to
   * another — the 2017 TetherToken lineage. Broadcast this first and wait for it to be mined, then
   * broadcast `tx`; the second approve is only valid once the allowance has been zeroed on-chain.
   * Absent for every other token, and for a wallet with nothing approved yet.
   */
  resetTx?: RawTxReturnType;
}

/** POST /swaps/intents — response body. */
export interface CreateIntentResponseV2 {
  /** Unsigned create-intent transaction — the `RawTxReturnType` variant for the request's `srcChainKey`. */
  tx: RawTxReturnType;
  /** Built intent struct (hub representation). */
  intent: IntentResponseV2;
  /** Extra data required when calling `POST /swaps/intents/submit`. */
  relayData: RelayExtraDataResponseV2;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/submit
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/submit — request body. */
export interface SubmitIntentRequestV2 {
  /** Intent-relay chain id of the source chain (decimal string). NOT the SpokeChainKey. */
  chainId: string;
  /** Transaction hash on the source spoke chain after the caller broadcast the intent tx. */
  txHash: string;
  /** Required for Solana / Bitcoin sources — pass the `relayData` returned by `/swaps/intents` verbatim. */
  data?: RelayExtraDataRequestV2;
}

/** POST /swaps/intents/submit — response body. */
export interface SubmitIntentResponseV2 {
  /** Raw response from the intent relay. Shape varies; treat as opaque. */
  result: unknown;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/status
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/status — request body. */
export interface StatusRequestV2 {
  /** Hub-side intent transaction hash (32-byte hex). */
  intentTxHash: string;
}

/** POST /swaps/intents/status — response body. */
export interface StatusResponseV2 {
  /** Solver intent status code. */
  status: SwapIntentStatusCodeV2;
  /** Fill transaction hash on the destination chain. Present only when `status === 3` (SOLVED). */
  fillTxHash?: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/cancel
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/cancel — request body. */
export interface CancelIntentRequestV2 {
  /** Source spoke chain key on which the intent was created. */
  srcChainKey: string;
  /** Intent struct (as returned by `/swaps/intents`). */
  intent: IntentRequestV2;
}

/** POST /swaps/intents/cancel — response body. */
export interface CancelIntentResponseV2 {
  /** Unsigned cancel-intent transaction — the `RawTxReturnType` variant for the request's `srcChainKey`. */
  tx: RawTxReturnType;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/hash
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/hash — request body. */
export interface IntentHashRequestV2 {
  /** Intent struct to hash. */
  intent: IntentRequestV2;
}

/** POST /swaps/intents/hash — response body. */
export interface IntentHashResponseV2 {
  /** keccak256 hash of the intent struct (32-byte hex). */
  hash: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/packet
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/packet — request body. */
export interface IntentPacketRequestV2 {
  /** Destination spoke chain key on which the intent was filled. */
  chainId: string;
  /** Fill transaction hash on the destination chain (returned by `/swaps/intents/status`). */
  fillTxHash: string;
  /** Polling timeout in milliseconds. Defaults to the SDK default (~60s); minimum 1. */
  timeout?: number;
}

/** POST /swaps/intents/packet — response body. */
export interface IntentPacketResponseV2 {
  /** Source intent-relay chain id (numeric). */
  srcChainId: number;
  /** Source-chain transaction hash that originated the packet. */
  srcTxHash: string;
  /** Encoded source address. */
  srcAddress: string;
  /** Relay status (e.g. `executed`). */
  status: string;
  /** Destination intent-relay chain id (numeric). */
  dstChainId: number;
  /** Connection sequence number assigned by the relay. */
  connSn: number;
  /** Encoded destination address. */
  dstAddress: string;
  /** Destination-chain transaction hash where the fill landed. */
  dstTxHash: string;
  /** Relay signatures collected for this packet. */
  signatures: string[];
  /** Packet payload (hex). */
  payload: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/intents/extra-data
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/intents/extra-data — request body. Provide EITHER `txHash` OR `intent`, not both. */
export interface IntentExtraDataRequestV2 {
  /** Source-chain tx hash. Provide either this OR `intent`. */
  txHash?: string;
  /** Intent struct. Provide either this OR `txHash`. */
  intent?: IntentRequestV2;
}

/** POST /swaps/intents/extra-data — response body (same shape as relay extra data). */
export type IntentExtraDataResponseV2 = RelayExtraDataResponseV2;

// ──────────────────────────────────────────────────────────────────────
// GET /swaps/intents/:txHash/fill · GET /swaps/intents/:txHash
// ──────────────────────────────────────────────────────────────────────

/** GET /swaps/intents/:txHash/fill — on-chain fill state for an intent. */
export interface IntentStateV2 {
  /** Whether the intent exists on the hub chain. */
  exists: boolean;
  /** Remaining input amount left to fill (decimal string). */
  remainingInput: string;
  /** Received output amount so far (decimal string). */
  receivedOutput: string;
  /** Whether a payment is pending. */
  pendingPayment: boolean;
}

/**
 * GET /swaps/intents/:txHash — decoded Intent struct from the hub's IntentCreated
 * event. Bigint fields are serialized as decimal strings.
 */
export type GetIntentResponseV2 = IntentResponseV2;

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/limit-orders
// ──────────────────────────────────────────────────────────────────────

/**
 * POST /swaps/limit-orders — request body. Same as create-intent but `deadline` is optional.
 *
 * The trailing `& _AssertJsonSafe<…>` wires the compile-time JSON-safety guard (see the Config API v2
 * section) into the swap request surface: if a `bigint` ever leaks into `SwapExtrasV2` — or the
 * `PartnerFeeV2` / `BitcoinBoundExtrasV2` it composes — the constraint fails and `pnpm checkTs` /
 * `pnpm build` go red. It is `& unknown` in the happy path, so it does not change the type. This is the
 * swaps-section analog of the guard on `GetAllConfigResponseV2`; `CreateLimitOrderParamsV2` is the one
 * exported swaps request `type` (the others are interfaces, which cannot carry an intersection).
 */
export type CreateLimitOrderParamsV2 = Omit<CreateIntentParamsV2, 'deadline'> & {
  /** Unix timestamp (seconds) at which the limit order expires. Omit (or pass `"0"`) for no expiry. */
  deadline?: string;
} & _AssertJsonSafe<[_ContainsBigint<SwapExtrasV2>] extends [false] ? true : false>;

/** POST /swaps/limit-orders — response body (same shape as create-intent). */
export type CreateLimitOrderResponseV2 = CreateIntentResponseV2;

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/gas/estimate
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/gas/estimate — request body. */
export interface GasEstimateRequestV2 {
  /** Spoke chain key the transaction targets. */
  chainKey: string;
  /** Raw transaction object (chain-specific shape). For EVM: `{ from, to, value, data }` with `value` as decimal string. */
  tx: Record<string, unknown>;
}

/** POST /swaps/gas/estimate — response body. */
export interface GasEstimateResponseV2 {
  /**
   * Gas estimate. Shape varies by chain family: EVM/Bitcoin/Near/Solana →
   * decimal string (bigint); Sui/Stellar/Stacks/Icon/Injective → structured object.
   */
  gas: unknown;
}

// ──────────────────────────────────────────────────────────────────────
// GET /swaps/fees/partner · GET /swaps/fees/solver
// ──────────────────────────────────────────────────────────────────────

/** GET /swaps/fees/partner and GET /swaps/fees/solver — query params. */
export interface FeeQueryV2 {
  /** Input amount in smallest unit (decimal string). */
  amount: string;
}

/** GET /swaps/fees/partner and GET /swaps/fees/solver — response body. */
export interface FeeResponseV2 {
  /** Fee amount in smallest unit of the input token (decimal string). */
  fee: string;
}

// ──────────────────────────────────────────────────────────────────────
// POST /swaps/submit-tx · GET /swaps/submit-tx/status
// ──────────────────────────────────────────────────────────────────────

/** POST /swaps/submit-tx — request body. */
export interface SubmitTxRequestV2 {
  /** Transaction hash of the tx that will be submitted (1–127 chars). */
  txHash: string;
  /** Source chain key (spoke chain the tx will be submitted from). */
  srcChainKey: string;
  /** Address of the wallet that will submit the tx (1–127 chars). */
  walletAddress: string;
  /** Intent object received from createIntent. */
  intent: IntentRequestV2;
  /** Relay data received from createIntent, submitted to the intent relay (hex). */
  relayData: string;
}

/** POST /swaps/submit-tx — response `data` payload. */
export interface SubmitTxResponseDataV2 {
  /** Whether the row was newly inserted or matched an existing record. */
  status: 'inserted' | 'duplicate';
  /** Message indicating the result of the submission. */
  message: string;
}

/** POST /swaps/submit-tx — response body. */
export interface SubmitTxResponseV2 {
  /** True when the submission was accepted (or was a duplicate). */
  success: boolean;
  /** Submission result payload. */
  data: SubmitTxResponseDataV2;
}

/** GET /swaps/submit-tx/status — query params. */
export interface SubmitTxStatusQueryV2 {
  /** Transaction hash of the submitted swap tx (1–127 chars). */
  txHash: string;
  /** Source chain key. */
  srcChainKey: string;
}

/** Lifecycle status of a submitted swap tx. */
export type SubmitSwapTxStatusV2 =
  | 'pending'
  | 'relaying'
  | 'relayed'
  | 'posting_execution'
  | 'posted_execution'
  | 'solved'
  | 'failed';

/**
 * Product/operation discriminator on a submit-tx status row. `'swap'` for an ordinary swap;
 * `'leverage_deposit'` / `'leverage_withdraw'` for a leverage-yield vault op queued via
 * `POST /leverage-yield/submit-tx` (the backend maps that body's `operation: 'deposit' | 'withdraw'`
 * onto these row-level values).
 */
export type SubmitTxOperationV2 = 'swap' | 'leverage_deposit' | 'leverage_withdraw';

/** Lifecycle status of a cross-chain relay packet. */
export type PacketDataStatusV2 = 'pending' | 'validating' | 'executing' | 'executed';

/** Relay packet data attached to a submit-tx processing result (snake_case as stored). */
export interface PacketDataV2 {
  /** Source intent-relay chain id (numeric). */
  src_chain_id: number;
  /** Source-chain transaction hash. */
  src_tx_hash: string;
  /** Encoded source address. */
  src_address: string;
  /** Packet lifecycle status. */
  status: PacketDataStatusV2;
  /** Destination intent-relay chain id (numeric). */
  dst_chain_id: number;
  /** Connection sequence number assigned by the relay. */
  conn_sn: number;
  /** Encoded destination address. */
  dst_address: string;
  /** Destination-chain transaction hash. */
  dst_tx_hash: string;
  /** Relay signatures collected for this packet. */
  signatures: string[];
  /** Packet payload (hex). */
  payload: string;
}

/** Processing result for a submitted swap tx (present when solved). */
export interface SubmitTxStatusResultV2 {
  /** Destination intent tx hash. */
  dstIntentTxHash: string;
  /** Packet data from the relay. */
  packetData?: PacketDataV2;
  /** Intent hash from the solver API (populated after post-execution). */
  intent_hash?: string;
  /**
   * Solver destination-chain fill tx hash. Set on solver-confirmed fills; MAY be absent even when
   * `status === 'solved'` if the fill was confirmed via the on-chain journal instead.
   */
  fillTxHash?: string;
}

/** Processing state of a submitted swap tx. */
export interface SubmitTxStatusDataV2 {
  /** Transaction hash. */
  txHash: string;
  /** Source chain key. */
  srcChainKey: string;
  /** Current processing status. */
  status: SubmitSwapTxStatusV2;
  /** Product/operation discriminator. Absent from backends predating the field — treat as `'swap'`. */
  operation?: SubmitTxOperationV2;
  /** Step where processing failed. */
  failedAtStep?: SubmitSwapTxStatusV2;
  /** Failure reason. */
  failureReason?: string;
  /** Number of processing attempts (claim-time counter). */
  processingAttempts: number;
  /** ISO 8601 timestamp set when the swap exhausted its processing budget and was abandoned. */
  abandonedAt?: string;
  /** ISO 8601 timestamp set when an expired, abandoned swap was relayed for refund; the row stays abandoned. */
  relayedForRefundAt?: string;
  /** Processing result (present when solved). */
  result?: SubmitTxStatusResultV2;
  /** User-facing hint when status is failed or the swap was abandoned. */
  userMessage?: string;
  /** True when an on-chain INTENT_CANCELLED event exists for this swap's intent (failed swaps only). */
  intentCancelled?: boolean;
}

/** GET /swaps/submit-tx/status — response body. */
export interface SubmitTxStatusResponseV2 {
  /** True when a record was found. */
  success: boolean;
  /** The submit-tx processing state. */
  data: SubmitTxStatusDataV2;
}

// ──────────────────────────────────────────────────────────────────────
// Aggregating client interface — one method per endpoint
// ──────────────────────────────────────────────────────────────────────

/**
 * Client-side surface for the backend Swaps API v2 — for typed HTTP clients
 * (fetch wrappers / SDK adapters). Each method describes one endpoint as the
 * client sees it: all methods are async and all field types are the
 * post-serialization wire shapes above (bigint/Date → decimal/ISO `string`).
 *
 * The backend `SwapsController` `implements` this, which is what keeps the two surfaces from
 * drifting. Two things make that work: handlers are DECLARED with the wire-shaped response DTOs
 * (what they hand back at runtime may still be pre-serialization domain values — `bigint`, `Date`,
 * branded `Hex`/`Address`/`SpokeChainKey` — for the response interceptor to convert), and every
 * handler is `async`. A handler needing a server-only trailing parameter (`@Req`, `@Ip`, …) takes
 * the variadic-generic route of `IStellarSponsoringApi` in `sponsoringApi.ts` rather than dropping
 * the `implements` clause.
 */
export interface ISwapsApiV2 {
  /** GET /swaps/tokens */
  getTokens(): Promise<GetSwapTokensResponseV2>;
  /** GET /swaps/tokens/:chainKey */
  getTokensByChain(chainKey: string): Promise<GetSwapTokensByChainResponseV2>;
  /** POST /swaps/quote */
  getQuote(body: QuoteRequestV2, query?: QuoteQueryV2): Promise<QuoteResponseV2>;
  /** GET /swaps/deadline */
  getDeadline(query?: DeadlineQueryV2): Promise<DeadlineResponseV2>;
  /** POST /swaps/allowance/check */
  checkAllowance(body: CreateIntentParamsV2): Promise<AllowanceCheckResponseV2>;
  /** POST /swaps/approve */
  approve(body: CreateIntentParamsV2): Promise<ApproveResponseV2>;
  /** POST /swaps/intents */
  createIntent(body: CreateIntentParamsV2): Promise<CreateIntentResponseV2>;
  /** POST /swaps/intents/submit */
  submitIntent(body: SubmitIntentRequestV2): Promise<SubmitIntentResponseV2>;
  /** POST /swaps/intents/status */
  getStatus(body: StatusRequestV2): Promise<StatusResponseV2>;
  /** POST /swaps/intents/cancel */
  cancelIntent(body: CancelIntentRequestV2): Promise<CancelIntentResponseV2>;
  /** POST /swaps/intents/hash */
  getIntentHash(body: IntentHashRequestV2): Promise<IntentHashResponseV2>;
  /** POST /swaps/intents/packet */
  getSolvedIntentPacket(body: IntentPacketRequestV2): Promise<IntentPacketResponseV2>;
  /** POST /swaps/intents/extra-data */
  getIntentSubmitTxExtraData(body: IntentExtraDataRequestV2): Promise<IntentExtraDataResponseV2>;
  /** GET /swaps/intents/:txHash/fill */
  getFilledIntent(txHash: string): Promise<IntentStateV2>;
  /** GET /swaps/intents/:txHash */
  getIntent(txHash: string): Promise<GetIntentResponseV2>;
  /** POST /swaps/limit-orders */
  createLimitOrderIntent(body: CreateLimitOrderParamsV2): Promise<CreateLimitOrderResponseV2>;
  /** POST /swaps/gas/estimate */
  estimateGas(body: GasEstimateRequestV2): Promise<GasEstimateResponseV2>;
  /** GET /swaps/fees/partner */
  getPartnerFee(query: FeeQueryV2): Promise<FeeResponseV2>;
  /** GET /swaps/fees/solver */
  getSolverFee(query: FeeQueryV2): Promise<FeeResponseV2>;
  /** POST /swaps/submit-tx */
  submitTx(body: SubmitTxRequestV2): Promise<SubmitTxResponseV2>;
  /** GET /swaps/submit-tx/status */
  getSubmitTxStatus(query: SubmitTxStatusQueryV2): Promise<SubmitTxStatusResponseV2>;
}

// ══════════════════════════════════════════════════════════════════════
// Config API v2 — static SODAX configuration
// ══════════════════════════════════════════════════════════════════════
//
// JSON-safe contract for the backend that serves the `@sodax/types` STATIC config
// (`SodaxDefaultConfig`) so the SDK's `ConfigService` can load it dynamically.
//
// `SodaxDefaultConfig` is the default/static data shape ONLY — NOT the merged
// `SodaxConfig` (`SodaxDefaultConfig & SodaxOptions`). Client options never travel on
// the CONFIG wire: the global `fee`, the `logger`, and every per-feature `partnerFee` CONFIG
// override live on `SodaxOptions`, resolved client-side, so they are all excluded from this
// config contract. (Config only — distinct from a swap REQUEST, which may carry a per-request
// `partnerFee`; see `CreateIntentParamsV2` / `QuoteRequestV2` above.)
//
// Unlike the swaps section above — which re-declares every shape with plain
// primitives — the config section REUSES the canonical `SodaxDefaultConfig` type tree
// and projects ONLY the fields that carry `bigint` to a decimal `string`. JSON
// cannot represent `bigint`; everything else in `SodaxDefaultConfig` (chain configs,
// hub, the static feature configs, api, solver, `XToken`, `PoolKey`) is already JSON-safe
// (its addresses/keys/urls are `string` brands and the rest is strings/numbers).
// Reusing the source types keeps this contract from drifting away from it.
//
// The COMPLETE bigint inventory in `SodaxConfigV2` — the only fields these wire
// types override — is:
//   1. `relay.relayChainIdMap`                         Record<…, bigint> → Record<string, string>
//   2. `dex.concentratedLiquidityConfig.defaultBitmap` bigint            → string
//
// There is no partner-fee entry in this config contract: the partner-fee CONFIG is an option on
// `SodaxOptions`, and `SodaxDefaultConfig` exposes only static `*DefaultConfig` per-feature configs,
// so no config option ever reaches this contract (see `SodaxConfigV2` below). This constrains the
// config wire only — a per-request swap `partnerFee` still lives on the swap request DTOs above.

// ──────────────────────────────────────────────────────────────────────
// Relay (bigint #1) and DEX (bigint #2)
// ──────────────────────────────────────────────────────────────────────

/** JSON-safe {@link RelayConfig}: relay chain ids are decimal strings on the wire. */
export type RelayConfigV2 = Omit<RelayConfig, 'relayChainIdMap'> & {
  /** SpokeChainKey → intent-relay chain id as a decimal string (e.g. `"146"`). */
  relayChainIdMap: Record<string, string>;
};

/** JSON-safe {@link ConcentratedLiquidityConfig}: `defaultBitmap` is a decimal string. */
export type ConcentratedLiquidityConfigV2 = Omit<ConcentratedLiquidityConfig, 'defaultBitmap'> & {
  /** Default tick bitmap; bigint projected to a decimal string. */
  defaultBitmap: string;
};

/** JSON-safe {@link DexDefaultConfig}. Only the concentrated-liquidity config carries bigint. */
export type DexConfigV2 = Omit<DexDefaultConfig, 'concentratedLiquidityConfig'> & {
  concentratedLiquidityConfig: ConcentratedLiquidityConfigV2;
};

// ──────────────────────────────────────────────────────────────────────
// Top-level config
// ──────────────────────────────────────────────────────────────────────

/**
 * JSON-safe projection of {@link SodaxDefaultConfig} — the STATIC config the backend serves,
 * never the merged `SodaxConfig`. `SodaxDefaultConfig` already exposes only static per-feature
 * configs (`SwapsDefaultConfig`, `MoneyMarketDefaultConfig`, `BridgeDefaultConfig`,
 * `LeverageYieldDefaultConfig`, `DexDefaultConfig`), so every field is reused untouched —
 * `chains`, `swaps`, `moneyMarket`, `bridge`, `leverageYield`, `hub`, `api`, `solver` are all
 * JSON-safe as-is. Only `dex` and `relay` are projected to their `*V2` variants because they
 * carry a `bigint` field.
 *
 * No options ever reach the wire: the global `fee`, the `logger`, and every per-feature
 * `partnerFee` live on `SodaxOptions` (resolved client-side), which is not part of `SodaxDefaultConfig`.
 */
export type SodaxConfigV2 = Omit<SodaxDefaultConfig, 'dex' | 'relay'> & {
  dex: DexConfigV2;
  relay: RelayConfigV2;
};

// ──────────────────────────────────────────────────────────────────────
// GET /config/all
// ──────────────────────────────────────────────────────────────────────

/**
 * GET /config/all — full config plus its schema version for drift detection.
 *
 * `version` is REQUIRED here (the v1 `GetAllConfigApiResponse.version` is optional):
 * `ConfigService` already treats a missing/older version as "reject and keep the
 * packaged defaults", so a required field is a strictly cleaner v2 contract.
 */
// The trailing `& _AssertJsonSafe<…>` is an erasable identity intersection (`& unknown`)
// that wires the compile-time bigint guard (see the "Compile-time drift guard" block at the
// end of this file) into an exported type. While the config wire types stay JSON-safe it is
// a no-op; if a `bigint` ever leaks in, it collapses to a constraint error reported here.
export type GetAllConfigResponseV2 = {
  /** Config schema version; compared against the SDK's `CONFIG_VERSION`. */
  version: number;
  /** Full JSON-safe SODAX config. */
  config: SodaxConfigV2;
} & _AssertJsonSafe<[_ContainsBigint<SodaxConfigV2>] extends [false] ? true : false>;

// ──────────────────────────────────────────────────────────────────────
// Granular config endpoints (mirror the v1 IConfigApi slices)
// ──────────────────────────────────────────────────────────────────────

/** GET /config/spoke/chains — supported spoke chain keys. */
export type GetChainsResponseV2 = readonly string[];

/** GET /config/spoke/all-chains-configs — full per-chain config (no bigint → `SpokeChainConfig` reused). */
export type GetSpokeChainConfigsResponseV2 = Record<string, SpokeChainConfig>;

/**
 * GET /config/swap/tokens — supported swap tokens per chain.
 *
 * Returns the canonical {@link XToken} (incl. its optional `access`), NOT the
 * swaps-domain `SwapTokenV2`: this is config data, so it mirrors the source token
 * exactly. (`GetSwapTokensResponseV2` above is the unrelated `/swaps/tokens` shape.)
 */
export type GetSwapTokensConfigResponseV2 = Record<string, readonly XToken[]>;

/** GET /config/swap/:chainKey/tokens — supported swap tokens for one chain. */
export type GetSwapTokensConfigByChainResponseV2 = readonly XToken[];

/** GET /config/money-market/tokens — supported money-market tokens per chain. */
export type GetMoneyMarketTokensConfigResponseV2 = Record<string, readonly XToken[]>;

/** GET /config/money-market/:chainKey/tokens — supported money-market tokens for one chain. */
export type GetMoneyMarketTokensConfigByChainResponseV2 = readonly XToken[];

/** GET /config/money-market/reserve-assets — hub reserve asset addresses. */
export type GetMoneyMarketReserveAssetsResponseV2 = readonly string[];

/** GET /config/relay/chain-id-map — SpokeChainKey → intent-relay chain id (decimal string). */
export type GetRelayChainIdMapResponseV2 = Record<string, string>;

// ──────────────────────────────────────────────────────────────────────
// Aggregating client interface — one method per endpoint
// ──────────────────────────────────────────────────────────────────────

/**
 * Client-side surface for the backend Config API v2 — for typed HTTP clients
 * (fetch wrappers / SDK adapters). Each method describes one endpoint as the
 * client sees it: all methods are async and all field types are the
 * post-serialization wire shapes above (bigint → decimal `string`).
 *
 * As with {@link ISwapsApiV2}, a NestJS controller may `implements` this once its handlers are
 * declared `async` and typed with the wire-shaped DTOs.
 */
export interface IConfigApiV2 {
  /** GET /config/all */
  getAllConfig(): Promise<GetAllConfigResponseV2>;
  /** GET /config/spoke/chains */
  getChains(): Promise<GetChainsResponseV2>;
  /** GET /config/spoke/all-chains-configs */
  getSpokeChainConfigs(): Promise<GetSpokeChainConfigsResponseV2>;
  /** GET /config/swap/tokens */
  getSwapTokens(): Promise<GetSwapTokensConfigResponseV2>;
  /** GET /config/swap/:chainKey/tokens */
  getSwapTokensByChain(chainKey: string): Promise<GetSwapTokensConfigByChainResponseV2>;
  /** GET /config/money-market/tokens */
  getMoneyMarketTokens(): Promise<GetMoneyMarketTokensConfigResponseV2>;
  /** GET /config/money-market/:chainKey/tokens */
  getMoneyMarketTokensByChain(chainKey: string): Promise<GetMoneyMarketTokensConfigByChainResponseV2>;
  /** GET /config/money-market/reserve-assets */
  getMoneyMarketReserveAssets(): Promise<GetMoneyMarketReserveAssetsResponseV2>;
  /** GET /config/relay/chain-id-map */
  getRelayChainIdMap(): Promise<GetRelayChainIdMapResponseV2>;
}

// ──────────────────────────────────────────────────────────────────────
// Compile-time drift guard
// ──────────────────────────────────────────────────────────────────────
//
// Makes the "reuse + project bigint" strategy above self-enforcing. The config v2 wire
// types reuse source types (`SpokeChainConfig`, `XToken`, `PoolKey`, …) and override only
// the known bigint spots. If a `bigint` is ever introduced anywhere in `SodaxConfigV2`
// (e.g. a field added to a reused source type), `_AssertJsonSafe<false>` trips a constraint
// error at the `GetAllConfigResponseV2` definition above and `pnpm checkTs` / `pnpm build`
// go red — because JSON cannot carry bigint and these types claim to be JSON-safe.
//
// Asserting `SodaxConfigV2` is sufficient: it transitively reaches every reused config type
// (chains → SpokeChainConfig → supportedTokens → XToken, dex, relay, …), so the granular
// response types — all subsets of it — are covered too. These helpers are referenced by the exported
// `GetAllConfigResponseV2` and by the swaps-section JSON-safety guard on `CreateLimitOrderParamsV2`, so
// they stay non-exported (no knip "unused export").

/** True if `T` contains a `bigint` anywhere in its data shape. Recurses arrays/records/objects. */
type _ContainsBigint<T> = T extends bigint
  ? true
  : T extends string | number | boolean | symbol | null | undefined
    ? false
    : T extends readonly (infer U)[]
      ? _ContainsBigint<U>
      : T extends object
        ? true extends { [K in keyof T]-?: _ContainsBigint<T[K]> }[keyof T]
          ? true
          : false
        : false;

/**
 * Resolves to `unknown` (an identity in an intersection) when `Ok` proves JSON-safety;
 * otherwise the `Ok extends true` constraint is violated and compilation fails at the use site.
 * The caller passes `[_ContainsBigint<T>] extends [false] ? true : false` — the `[…] extends […]`
 * wrap is union-safe (a `true | false` result from union distribution still resolves to `false`).
 */
type _AssertJsonSafe<_Ok extends true> = unknown;
