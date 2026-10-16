import type {
  BridgeAllowanceCheckResponseV2,
  BridgeApproveResponseV2,
  BridgeSubmitTxResponseV2,
  BridgeSubmitTxStatusResponseV2,
  BridgeTokenV2,
  BridgeableAmountResponseV2,
  BridgeableCheckResponseV2,
  BridgeFeeResponseV2,
  CreateBridgeIntentResponseV2,
  GetBridgeTokensByChainResponseV2,
  GetBridgeTokensResponseV2,
  PacketDataV2,
  RawTxReturnType,
  RelayExtraDataResponseV2,
} from '@sodax/types';
import * as v from 'valibot';

// Internal response schemas mirroring `backendBridgeApiV2.ts`; `v.object` ignores additive backend
// fields. The unsigned `tx` is validated+transformed per source chain via `rawTxSchemas.ts`
// (tx-bearing responses are `make*ResponseSchema(txSchema)` factories).
//
// Bridge deltas vs swaps:
//   - create-intent response is `{ tx, relayData }` (NO `intent` struct — bridge is vault-backed,
//     not solver-based).
//   - submit-tx-status `status` is TOLERANT (`v.string()`, not a picklist) so a future backend
//     lifecycle state never breaks parse; callers compare against the known terminal literals
//     (`'executed'` / `'failed'`) instead.
//   - submit-tx-status `result` has NO `intent_hash` (no solver).

// ── Shared building blocks ────────────────────────────────────────────

/** Relay envelope (`{ address, payload }`) attached to the create-intent response. */
const RelayExtraDataResponseSchema = v.object({
  address: v.string(),
  payload: v.string(),
});

/** A supported bridge token descriptor (`BridgeTokenV2`). */
const BridgeTokenSchema = v.object({
  symbol: v.string(),
  name: v.string(),
  decimals: v.number(),
  address: v.string(),
  chainKey: v.string(),
  hubAsset: v.string(),
  vault: v.string(),
});

// ── Per-endpoint response schemas ─────────────────────────────────────

/** GET /bridge/tokens (`GetBridgeTokensResponseV2`). */
export const BridgeTokensResponseSchema = v.record(v.string(), v.array(BridgeTokenSchema));

/** GET /bridge/tokens/:chainKey (`GetBridgeTokensByChainResponseV2`). */
export const BridgeTokensByChainResponseSchema = v.array(BridgeTokenSchema);

/** POST /bridge/allowance/check (`BridgeAllowanceCheckResponseV2`). */
export const BridgeAllowanceCheckResponseSchema = v.object({
  valid: v.boolean(),
});

/**
 * POST /bridge/approve (`BridgeApproveResponseV2`). Parameterized by the chain-specific
 * `tx` schema (see `rawTxSchemaForChainKey`) so `tx` is validated and transformed to its
 * domain variant. `resetTx` rides the same schema — see `BridgeApproveResponseV2` for when it appears.
 */
export const makeBridgeApproveResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({ tx: txSchema, resetTx: v.optional(txSchema) });

/**
 * POST /bridge/intents (`CreateBridgeIntentResponseV2`). `{ tx, relayData }` — no `intent`
 * struct (bridge is vault-backed, not solver-based).
 */
export const makeCreateBridgeIntentResponseSchema = (txSchema: v.GenericSchema<unknown, RawTxReturnType>) =>
  v.object({
    tx: txSchema,
    relayData: RelayExtraDataResponseSchema,
  });

/** POST /bridge/submit-tx (`BridgeSubmitTxResponseV2`). */
export const BridgeSubmitTxResponseSchema = v.object({
  success: v.boolean(),
  data: v.object({
    status: v.picklist(['inserted', 'duplicate']),
    message: v.string(),
  }),
});

/** Relay packet data attached to a submit-tx result (`PacketDataV2`, snake_case as stored). */
const BridgePacketDataSchema = v.object({
  src_chain_id: v.number(),
  src_tx_hash: v.string(),
  src_address: v.string(),
  status: v.picklist(['pending', 'validating', 'executing', 'executed']),
  dst_chain_id: v.number(),
  conn_sn: v.number(),
  dst_address: v.string(),
  dst_tx_hash: v.string(),
  signatures: v.array(v.string()),
  payload: v.string(),
});

/** Processing result for a submitted bridge tx, present when executed (`BridgeSubmitTxStatusResultV2`). No `intent_hash`. */
const BridgeSubmitTxStatusResultSchema = v.object({
  dstIntentTxHash: v.string(),
  packetData: v.optional(BridgePacketDataSchema),
});

/**
 * Processing state of a submitted bridge tx (`BridgeSubmitTxStatusDataV2`). `status` /
 * `failedAtStep` are tolerant `v.string()` so an unknown backend lifecycle state never breaks
 * parse; `v.object` ignores unexpected extra keys for the same reason.
 */
const BridgeSubmitTxStatusDataSchema = v.object({
  txHash: v.string(),
  srcChainKey: v.string(),
  status: v.string(),
  failedAtStep: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  processingAttempts: v.number(),
  abandonedAt: v.optional(v.string()),
  result: v.optional(BridgeSubmitTxStatusResultSchema),
  userMessage: v.optional(v.string()),
});

/** GET /bridge/submit-tx/status (`BridgeSubmitTxStatusResponseV2`). */
export const BridgeSubmitTxStatusResponseSchema = v.object({
  success: v.boolean(),
  data: BridgeSubmitTxStatusDataSchema,
});

/** POST /bridge/fee (`BridgeFeeResponseV2`). */
export const BridgeFeeResponseSchema = v.object({ fee: v.string() });

/** A bridge limit (`BridgeLimitV2`) — bigint `amount` serialized as a decimal string. */
const BridgeLimitSchema = v.object({
  amount: v.string(),
  decimals: v.number(),
  type: v.picklist(['DEPOSIT_LIMIT', 'WITHDRAWAL_LIMIT']),
});

/** POST /bridge/bridgeable-amount (`BridgeableAmountResponseV2`). */
export const BridgeableAmountResponseSchema = v.object({ limit: BridgeLimitSchema });

/** POST /bridge/bridgeable/check (`BridgeableCheckResponseV2`). */
export const BridgeableCheckResponseSchema = v.object({ bridgeable: v.boolean() });

// ── Compile-time drift guards ─────────────────────────────────────────
// Each entry fails `tsc` if a schema's inferred output stops matching its contract type. `Equal` is
// strict; `Extends` is one-way, used only for the `readonly` array/record responses (their element
// type is `Equal`-guarded via `BridgeTokenSchema`). The tx-bearing factories use `Equal`: both
// contract types declare `tx: RawTxReturnType` exactly, so a field REMOVED from the contract
// (which one-way `Extends` would miss) also trips at `tsc` time.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type Expect<T extends true> = T;

/**
 * @public Compile-time only. Each entry fails `tsc` if a schema drifts from its contract type.
 * Intentionally exported — un-exporting trips TS6196 (declared but never used).
 */
export type SchemaDriftGuards = [
  Expect<Equal<v.InferOutput<typeof BridgeTokenSchema>, BridgeTokenV2>>,
  Expect<Equal<v.InferOutput<typeof RelayExtraDataResponseSchema>, RelayExtraDataResponseV2>>,
  Expect<Equal<v.InferOutput<typeof BridgePacketDataSchema>, PacketDataV2>>,
  Expect<Extends<v.InferOutput<typeof BridgeTokensResponseSchema>, GetBridgeTokensResponseV2>>,
  Expect<Extends<v.InferOutput<typeof BridgeTokensByChainResponseSchema>, GetBridgeTokensByChainResponseV2>>,
  Expect<Equal<v.InferOutput<typeof BridgeAllowanceCheckResponseSchema>, BridgeAllowanceCheckResponseV2>>,
  Expect<Equal<v.InferOutput<ReturnType<typeof makeBridgeApproveResponseSchema>>, BridgeApproveResponseV2>>,
  Expect<Equal<v.InferOutput<ReturnType<typeof makeCreateBridgeIntentResponseSchema>>, CreateBridgeIntentResponseV2>>,
  Expect<Equal<v.InferOutput<typeof BridgeSubmitTxResponseSchema>, BridgeSubmitTxResponseV2>>,
  Expect<Equal<v.InferOutput<typeof BridgeSubmitTxStatusResponseSchema>, BridgeSubmitTxStatusResponseV2>>,
  Expect<Equal<v.InferOutput<typeof BridgeFeeResponseSchema>, BridgeFeeResponseV2>>,
  Expect<Equal<v.InferOutput<typeof BridgeableAmountResponseSchema>, BridgeableAmountResponseV2>>,
  Expect<Equal<v.InferOutput<typeof BridgeableCheckResponseSchema>, BridgeableCheckResponseV2>>,
];
