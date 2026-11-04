import type {
  AllowanceCheckResponseV2,
  ApproveResponseV2,
  CancelIntentResponseV2,
  CreateIntentResponseV2,
  CreateLimitOrderResponseV2,
  DeadlineResponseV2,
  FeeResponseV2,
  GasEstimateResponseV2,
  GetIntentResponseV2,
  GetSwapTokensByChainResponseV2,
  GetSwapTokensResponseV2,
  IntentExtraDataResponseV2,
  IntentHashResponseV2,
  IntentPacketResponseV2,
  IntentResponseV2,
  IntentStateV2,
  QuoteResponseV2,
  RelayExtraDataResponseV2,
  StatusResponseV2,
  SubmitIntentResponseV2,
  SubmitTxResponseV2,
  SubmitTxStatusResponseV2,
  RawTxReturnType,
  SwapTokenV2,
} from '@sodax/types';
import * as v from 'valibot';

// Internal response schemas mirroring `backendApiV2.ts`; `v.object` ignores additive backend fields.
// The unsigned `tx` is validated+transformed per source chain via `rawTxSchemas.ts` (tx-bearing
// responses are `make*ResponseSchema(txSchema)` factories); other opaque payloads stay `v.unknown()`.

// ── Shared building blocks ────────────────────────────────────────────

const SwapTokenSchema = v.object({
  symbol: v.string(),
  name: v.string(),
  decimals: v.number(),
  address: v.string(),
  chainKey: v.string(),
  hubAsset: v.string(),
  vault: v.string(),
});

const IntentResponseSchema = v.object({
  intentId: v.string(),
  creator: v.string(),
  inputToken: v.string(),
  outputToken: v.string(),
  inputAmount: v.string(),
  minOutputAmount: v.string(),
  deadline: v.string(),
  allowPartialFill: v.boolean(),
  srcChain: v.string(),
  dstChain: v.string(),
  srcAddress: v.string(),
  dstAddress: v.string(),
  solver: v.string(),
  data: v.string(),
});

const RelayExtraDataResponseSchema = v.object({
  address: v.string(),
  payload: v.string(),
});

/**
 * Unsigned create-intent tx + built intent + relay payload (`CreateIntentResponseV2` /
 * `CreateLimitOrderResponseV2`). Parameterized by the chain-specific `tx` schema (see
 * `rawTxSchemaForChainKey`) so `tx` is validated and transformed to its `RawTxReturnType` variant.
 */
export const makeCreateIntentResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({
    tx: txSchema,
    intent: IntentResponseSchema,
    relayData: RelayExtraDataResponseSchema,
  });

// ── Per-endpoint response schemas ─────────────────────────────────────

export const GetSwapTokensResponseSchema = v.record(v.string(), v.array(SwapTokenSchema));
export const GetSwapTokensByChainResponseSchema = v.array(SwapTokenSchema);

/** POST /swaps/quote. `txData` (present only when `includeTxData=true`) carries the unsigned tx. */
export const makeQuoteResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({
    quotedAmount: v.string(),
    txData: v.optional(makeCreateIntentResponseSchema(txSchema)),
  });

export const DeadlineResponseSchema = v.object({ deadline: v.string() });

export const AllowanceCheckResponseSchema = v.object({ valid: v.boolean() });

export const makeApproveResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({ tx: txSchema, resetTx: v.optional(txSchema) });

export const SubmitIntentResponseSchema = v.object({ result: v.unknown() });

export const StatusResponseSchema = v.object({
  status: v.picklist([-1, 1, 2, 3, 4]),
  fillTxHash: v.optional(v.string()),
});

export const makeCancelIntentResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({ tx: txSchema });

export const IntentHashResponseSchema = v.object({ hash: v.string() });

export const IntentPacketResponseSchema = v.object({
  srcChainId: v.number(),
  srcTxHash: v.string(),
  srcAddress: v.string(),
  status: v.string(),
  dstChainId: v.number(),
  connSn: v.number(),
  dstAddress: v.string(),
  dstTxHash: v.string(),
  signatures: v.array(v.string()),
  payload: v.string(),
});

export const IntentExtraDataResponseSchema = RelayExtraDataResponseSchema;

export const IntentStateSchema = v.object({
  exists: v.boolean(),
  remainingInput: v.string(),
  receivedOutput: v.string(),
  pendingPayment: v.boolean(),
});

export const GetIntentResponseSchema = IntentResponseSchema;

// `createLimitOrderIntent` shares `CreateIntentResponseV2`'s shape — the client reuses
// `makeCreateIntentResponseSchema(txSchema)` rather than a separate alias.

export const GasEstimateResponseSchema = v.object({ gas: v.unknown() });

export const FeeResponseSchema = v.object({ fee: v.string() });

const SubmitTxResponseDataSchema = v.object({
  status: v.picklist(['inserted', 'duplicate']),
  message: v.string(),
});

export const SubmitTxResponseSchema = v.object({
  success: v.boolean(),
  data: SubmitTxResponseDataSchema,
});

const PacketDataStatusSchema = v.picklist(['pending', 'validating', 'executing', 'executed']);
const SubmitSwapTxStatusSchema = v.picklist([
  'pending',
  'relaying',
  'relayed',
  'posting_execution',
  'posted_execution',
  'solved',
  'failed',
]);

const PacketDataSchema = v.object({
  src_chain_id: v.number(),
  src_tx_hash: v.string(),
  src_address: v.string(),
  status: PacketDataStatusSchema,
  dst_chain_id: v.number(),
  conn_sn: v.number(),
  dst_address: v.string(),
  dst_tx_hash: v.string(),
  signatures: v.array(v.string()),
  payload: v.string(),
});

// Mirrors `SubmitTxOperationV2`; the backend's `SubmitTxOperationValues` is the source of truth.
const SubmitTxOperationSchema = v.picklist(['swap', 'leverage_deposit', 'leverage_withdraw']);

const SubmitTxStatusResultSchema = v.object({
  dstIntentTxHash: v.string(),
  packetData: v.optional(PacketDataSchema),
  intent_hash: v.optional(v.string()),
  fillTxHash: v.optional(v.string()),
});

const SubmitTxStatusDataSchema = v.object({
  txHash: v.string(),
  srcChainKey: v.string(),
  status: SubmitSwapTxStatusSchema,
  operation: v.optional(SubmitTxOperationSchema),
  failedAtStep: v.optional(SubmitSwapTxStatusSchema),
  failureReason: v.optional(v.string()),
  processingAttempts: v.number(),
  abandonedAt: v.optional(v.string()),
  relayedForRefundAt: v.optional(v.string()),
  result: v.optional(SubmitTxStatusResultSchema),
  userMessage: v.optional(v.string()),
  intentCancelled: v.optional(v.boolean()),
});

export const SubmitTxStatusResponseSchema = v.object({
  success: v.boolean(),
  data: SubmitTxStatusDataSchema,
});

// ── Compile-time drift guards ─────────────────────────────────────────
// Each entry fails `tsc` if a schema's inferred output stops matching its contract type. `Equal` is
// strict; `Extends` is one-way for the `readonly` array/record responses and the tx-bearing factories
// (their inferred `tx` is `RawTxReturnType`, which `extends` this branch's contract `tx: unknown`).

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type Expect<T extends true> = T;

/**
 * @public Compile-time only. Each entry fails `tsc` if a schema drifts from its contract type.
 * Intentionally exported — un-exporting trips TS6196 (declared but never used).
 */
export type SchemaDriftGuards = [
  Expect<Equal<v.InferOutput<typeof SwapTokenSchema>, SwapTokenV2>>,
  Expect<Equal<v.InferOutput<typeof IntentResponseSchema>, IntentResponseV2>>,
  Expect<Equal<v.InferOutput<typeof RelayExtraDataResponseSchema>, RelayExtraDataResponseV2>>,
  Expect<Extends<v.InferOutput<ReturnType<typeof makeCreateIntentResponseSchema>>, CreateIntentResponseV2>>,
  Expect<Extends<v.InferOutput<typeof GetSwapTokensResponseSchema>, GetSwapTokensResponseV2>>,
  Expect<Extends<v.InferOutput<typeof GetSwapTokensByChainResponseSchema>, GetSwapTokensByChainResponseV2>>,
  Expect<Extends<v.InferOutput<ReturnType<typeof makeQuoteResponseSchema>>, QuoteResponseV2>>,
  Expect<Equal<v.InferOutput<typeof DeadlineResponseSchema>, DeadlineResponseV2>>,
  Expect<Equal<v.InferOutput<typeof AllowanceCheckResponseSchema>, AllowanceCheckResponseV2>>,
  Expect<Extends<v.InferOutput<ReturnType<typeof makeApproveResponseSchema>>, ApproveResponseV2>>,
  Expect<Equal<v.InferOutput<typeof SubmitIntentResponseSchema>, SubmitIntentResponseV2>>,
  Expect<Equal<v.InferOutput<typeof StatusResponseSchema>, StatusResponseV2>>,
  Expect<Extends<v.InferOutput<ReturnType<typeof makeCancelIntentResponseSchema>>, CancelIntentResponseV2>>,
  Expect<Equal<v.InferOutput<typeof IntentHashResponseSchema>, IntentHashResponseV2>>,
  Expect<Equal<v.InferOutput<typeof IntentPacketResponseSchema>, IntentPacketResponseV2>>,
  Expect<Equal<v.InferOutput<typeof IntentExtraDataResponseSchema>, IntentExtraDataResponseV2>>,
  Expect<Equal<v.InferOutput<typeof IntentStateSchema>, IntentStateV2>>,
  Expect<Equal<v.InferOutput<typeof GetIntentResponseSchema>, GetIntentResponseV2>>,
  Expect<Extends<v.InferOutput<ReturnType<typeof makeCreateIntentResponseSchema>>, CreateLimitOrderResponseV2>>,
  Expect<Equal<v.InferOutput<typeof GasEstimateResponseSchema>, GasEstimateResponseV2>>,
  Expect<Equal<v.InferOutput<typeof FeeResponseSchema>, FeeResponseV2>>,
  Expect<Equal<v.InferOutput<typeof SubmitTxResponseSchema>, SubmitTxResponseV2>>,
  Expect<Equal<v.InferOutput<typeof SubmitTxStatusResponseSchema>, SubmitTxStatusResponseV2>>,
];
