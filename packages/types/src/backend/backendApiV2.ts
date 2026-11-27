// Backend Swaps API v2 contract. Responses are pure JSON (bigint → decimal string, Date → ISO string) except `tx`
// (`RawTxReturnType`, rebuilt by the wire clients' `rawTxSchemas`); request `IntentRequestV2` numerics are bigint.

import type { SpokeChainConfig } from '../chains/chains.js';
import type { XToken } from '../chains/tokens.js';
import type { RelayConfig } from '../common/constants.js';
import type { ConcentratedLiquidityConfig, DexDefaultConfig } from '../dex/dex.js';
import type { SodaxDefaultConfig } from '../sodax-config/sodax-config.js';

import type { RawTxReturnType } from '../common/index.js';
import type { HookKind } from '../hooks/hooks.js';

export type QuoteTypeV2 = 'exact_input';

/** `address` is the EVM hub fee receiver; `amount` is in input-token smallest units, `percentage` in bps (100 = 1%).
 * If both are present the backend uses `amount`, matching the SDK. */
export type PartnerFeeV2 = { address: string; amount: string } | { address: string; percentage: number };

/** Bound Exchange (Radfi) inputs for raw Bitcoin TRADING-mode intents. */
export interface BitcoinBoundExtrasV2 {
  /** Sent in the body instead of an `x-bound-access-token` header. */
  accessToken?: string;
}

/** Wire mirror of SDK `SwapExtras<K>`; chain applicability is per field since the DTO can't `K`-gate. */
export interface SwapExtrasV2 {
  /** No default on `/swaps/*`: omit and nothing is charged; SDK `fee` / `swaps.partnerFee` do not apply here. */
  partnerFee?: PartnerFeeV2;
  /** Compressed hex, for chains whose address can't yield it (e.g. Stacks); only used when building a raw intent. */
  srcPublicKey?: string;
  /** Only used for raw Bitcoin TRADING-mode intents. */
  bound?: BitcoinBoundExtrasV2;
  /** Routes output through a registered delivery hook; `dstAddress` stays the credited recipient. Only used when building an
   * intent (`createIntent`, limit orders, `getQuote` with `includeTxData=true`); `checkAllowance`/`approve` ignore it. */
  hook?: HookRequestV2;
}

/** -1 NOT_FOUND, 1 NOT_STARTED_YET, 2 STARTED_NOT_FINISHED, 3 SOLVED (terminal), 4 FAILED (terminal). */
export type SwapIntentStatusCodeV2 = -1 | 1 | 2 | 3 | 4;

export interface SwapTokenV2 {
  symbol: string;
  name: string;
  decimals: number;
  /** Spoke-chain address (hub address for hub tokens). */
  address: string;
  /** SpokeChainKey (e.g. `0xa4b1.arbitrum`, `solana`). */
  chainKey: string;
  /** Hub (Sonic) asset address. */
  hubAsset: string;
  /** Hub vault custodying bridged liquidity for this token. */
  vault: string;
}

/** Client-sent intent (mirrors backend `IntentDto`): numerics are `bigint`, serialized to decimal strings on the wire. */
export interface IntentRequestV2 {
  intentId: bigint;
  creator: string;
  /** Hub asset address. */
  inputToken: string;
  /** Hub asset address. */
  outputToken: string;
  /** Smallest unit. */
  inputAmount: bigint;
  /** Smallest unit. */
  minOutputAmount: bigint;
  /** Unix seconds; `0n` for no expiry. */
  deadline: bigint;
  allowPartialFill: boolean;
  /** Intent-relay chain id (e.g. `146n` for Sonic). */
  srcChain: bigint;
  /** Intent-relay chain id. */
  dstChain: bigint;
  /** Hex. */
  srcAddress: string;
  /** Hex. */
  dstAddress: string;
  /** The zero address means "any solver". */
  solver: string;
  /** Hex calldata. */
  data: string;
}

/** Server-returned intent: bigint-derived fields are decimal strings. */
export interface IntentResponseV2 {
  intentId: string;
  creator: string;
  /** Hub asset address. */
  inputToken: string;
  /** Hub asset address. */
  outputToken: string;
  /** Smallest unit (decimal string). */
  inputAmount: string;
  /** Smallest unit (decimal string). */
  minOutputAmount: string;
  /** Unix seconds; `"0"` for no expiry (decimal string). */
  deadline: string;
  allowPartialFill: boolean;
  /** Intent-relay chain id (decimal string, e.g. `"146"`). */
  srcChain: string;
  /** Intent-relay chain id (decimal string). */
  dstChain: string;
  /** Hex. */
  srcAddress: string;
  /** Hex. */
  dstAddress: string;
  /** The zero address means "any solver". */
  solver: string;
  /** Hex calldata. */
  data: string;
}

/** Required by `POST /swaps/intents/submit` for Solana / Bitcoin sources. */
export interface RelayExtraDataRequestV2 {
  /** Hex. */
  address: string;
  /** Hex. */
  payload: string;
}

export interface RelayExtraDataResponseV2 {
  /** Hex. */
  address: string;
  /** Hex. */
  payload: string;
}

/** Keyed by SpokeChainKey. */
export type GetSwapTokensResponseV2 = Record<string, readonly SwapTokenV2[]>;

export type GetSwapTokensByChainResponseV2 = readonly SwapTokenV2[];

/** Inherited `srcPublicKey`/`bound`/`hook` and `srcAddress`/`dstAddress` are used only when `includeTxData=true`. */
export interface QuoteRequestV2 extends SwapExtrasV2 {
  tokenSrc: string;
  tokenSrcChainKey: string;
  tokenDst: string;
  tokenDstChainKey: string;
  /** Smallest unit of the source token (decimal string). */
  amount: string;
  quoteType: QuoteTypeV2;
  /** Required only when `includeTxData=true`. */
  srcAddress?: string;
  /** Required only when `includeTxData=true`. */
  dstAddress?: string;
}

export interface QuoteQueryV2 {
  /** When true, also builds `txData` using the quoted amount as `minOutputAmount`. */
  includeTxData?: boolean;
}

export interface QuoteResponseV2 {
  /** Smallest unit of the destination token (decimal string). */
  quotedAmount: string;
  /** Present only when `includeTxData=true`. */
  txData?: CreateIntentResponseV2;
}

export interface DeadlineQueryV2 {
  /** Seconds added to the hub timestamp; default 300, minimum 1. */
  offsetSeconds?: number;
}

export interface DeadlineResponseV2 {
  /** Unix seconds (decimal string). */
  deadline: string;
}

/** Body of `/swaps/allowance/check`, `/swaps/approve` and `/swaps/intents`; Bitcoin Bound token goes in `bound.accessToken`. */
export interface CreateIntentParamsV2 extends SwapExtrasV2 {
  srcChainKey: string;
  dstChainKey: string;
  /** Address on the source spoke chain. */
  inputToken: string;
  /** Address on the destination spoke chain. */
  outputToken: string;
  /** Smallest unit (decimal string). */
  inputAmount: string;
  /** Smallest unit (decimal string). */
  minOutputAmount: string;
  /** Unix seconds; `"0"` for limit-order semantics (decimal string). */
  deadline: string;
  allowPartialFill: boolean;
  /** Chain-specific format. */
  srcAddress: string;
  /** Chain-specific format. */
  dstAddress: string;
  /** EVM hub address; defaults to the zero address ("any solver"). */
  solver?: string;
  /** Hex calldata; defaults to `0x`. */
  data?: string;
}

/** Mirrors the SDK's `HookRequest`; the `deliveryData` ABI is per `HookKind`, so never hardcode it. */
export interface HookRequestV2 {
  kind: HookKind;
}

export interface AllowanceCheckResponseV2 {
  /** True when the source token allowance is already sufficient. */
  valid: boolean;
}

export interface ApproveResponseV2 {
  /** `RawTxReturnType` variant for the request's `srcChainKey`. */
  tx: RawTxReturnType;
  /** Only for tokens rejecting non-zero → non-zero allowance changes (TetherToken lineage): broadcast and mine
   * this zeroing tx first, then `tx`. */
  resetTx?: RawTxReturnType;
}

export interface CreateIntentResponseV2 {
  /** `RawTxReturnType` variant for the request's `srcChainKey`. */
  tx: RawTxReturnType;
  intent: IntentResponseV2;
  /** Pass to `POST /swaps/intents/submit`. */
  relayData: RelayExtraDataResponseV2;
}

export interface SubmitIntentRequestV2 {
  /** Intent-relay chain id of the source chain (decimal string), NOT the SpokeChainKey. */
  chainId: string;
  /** Source-chain hash of the broadcast intent tx. */
  txHash: string;
  /** Required for Solana / Bitcoin sources: the `relayData` from `/swaps/intents`, verbatim. */
  data?: RelayExtraDataRequestV2;
}

export interface SubmitIntentResponseV2 {
  /** Raw intent-relay response; shape varies, treat as opaque. */
  result: unknown;
}

export interface StatusRequestV2 {
  /** Hub-side intent tx hash. */
  intentTxHash: string;
}

export interface StatusResponseV2 {
  status: SwapIntentStatusCodeV2;
  /** Destination-chain fill tx; present only when `status === 3` (SOLVED). */
  fillTxHash?: string;
}

export interface CancelIntentRequestV2 {
  srcChainKey: string;
  intent: IntentRequestV2;
}

export interface CancelIntentResponseV2 {
  /** `RawTxReturnType` variant for the request's `srcChainKey`. */
  tx: RawTxReturnType;
}

export interface IntentHashRequestV2 {
  intent: IntentRequestV2;
}

export interface IntentHashResponseV2 {
  /** keccak256 of the intent struct. */
  hash: string;
}

export interface IntentPacketRequestV2 {
  /** Destination SpokeChainKey where the intent was filled. */
  chainId: string;
  /** From `/swaps/intents/status`. */
  fillTxHash: string;
  /** Polling timeout in ms; defaults to the SDK default (~60s), minimum 1. */
  timeout?: number;
}

export interface IntentPacketResponseV2 {
  /** Intent-relay chain id. */
  srcChainId: number;
  srcTxHash: string;
  srcAddress: string;
  /** Relay status, e.g. `executed`. */
  status: string;
  /** Intent-relay chain id. */
  dstChainId: number;
  /** Relay-assigned connection sequence number. */
  connSn: number;
  dstAddress: string;
  dstTxHash: string;
  signatures: string[];
  /** Hex. */
  payload: string;
}

/** Provide EITHER `txHash` OR `intent`, not both. */
export interface IntentExtraDataRequestV2 {
  /** Source-chain tx hash. */
  txHash?: string;
  intent?: IntentRequestV2;
}

export type IntentExtraDataResponseV2 = RelayExtraDataResponseV2;

/** On-chain hub fill state of an intent. */
export interface IntentStateV2 {
  exists: boolean;
  /** Decimal string. */
  remainingInput: string;
  /** Decimal string. */
  receivedOutput: string;
  pendingPayment: boolean;
}

/** Decoded from the hub's IntentCreated event. */
export type GetIntentResponseV2 = IntentResponseV2;

/** Create-intent body with optional `deadline`. The `_AssertJsonSafe` intersection fails compilation if a `bigint`
 * leaks into `SwapExtrasV2`; otherwise it is `unknown` and changes nothing. */
export type CreateLimitOrderParamsV2 = Omit<CreateIntentParamsV2, 'deadline'> & {
  /** Unix seconds; omit (or pass `"0"`) for no expiry. */
  deadline?: string;
} & _AssertJsonSafe<[_ContainsBigint<SwapExtrasV2>] extends [false] ? true : false>;

export type CreateLimitOrderResponseV2 = CreateIntentResponseV2;

export interface GasEstimateRequestV2 {
  chainKey: string;
  /** Chain-specific; for EVM `{ from, to, value, data }` with `value` as decimal string. */
  tx: Record<string, unknown>;
}

export interface GasEstimateResponseV2 {
  /** EVM/Bitcoin/Near/Solana → decimal string; Sui/Stellar/Stacks/Icon/Injective → structured object. */
  gas: unknown;
}

export interface FeeQueryV2 {
  /** Input amount in smallest unit (decimal string). */
  amount: string;
}

export interface FeeResponseV2 {
  /** Smallest unit of the input token (decimal string). */
  fee: string;
}

export interface SubmitTxRequestV2 {
  /** 1–127 chars. */
  txHash: string;
  srcChainKey: string;
  /** Submitting wallet; 1–127 chars. */
  walletAddress: string;
  /** From createIntent. */
  intent: IntentRequestV2;
  /** Hex relay data from createIntent. */
  relayData: string;
}

export interface SubmitTxResponseDataV2 {
  status: 'inserted' | 'duplicate';
  message: string;
}

export interface SubmitTxResponseV2 {
  /** True when accepted (including duplicates). */
  success: boolean;
  data: SubmitTxResponseDataV2;
}

export interface SubmitTxStatusQueryV2 {
  /** 1–127 chars. */
  txHash: string;
  srcChainKey: string;
}

export type SubmitSwapTxStatusV2 =
  | 'pending'
  | 'relaying'
  | 'relayed'
  | 'posting_execution'
  | 'posted_execution'
  | 'solved'
  | 'failed';

/** `leverage_*` rows come from `POST /leverage-yield/submit-tx`, whose `operation: 'deposit' | 'withdraw'`
 * the backend maps onto these values. */
export type SubmitTxOperationV2 = 'swap' | 'leverage_deposit' | 'leverage_withdraw';

export type PacketDataStatusV2 = 'pending' | 'validating' | 'executing' | 'executed';

/** Relay packet data, snake_case as stored. */
export interface PacketDataV2 {
  /** Intent-relay chain id. */
  src_chain_id: number;
  src_tx_hash: string;
  src_address: string;
  status: PacketDataStatusV2;
  /** Intent-relay chain id. */
  dst_chain_id: number;
  /** Relay-assigned connection sequence number. */
  conn_sn: number;
  dst_address: string;
  dst_tx_hash: string;
  signatures: string[];
  /** Hex. */
  payload: string;
}

export interface SubmitTxStatusResultV2 {
  dstIntentTxHash: string;
  packetData?: PacketDataV2;
  /** From the solver API; populated after post-execution. */
  intent_hash?: string;
  /** Solver fill tx hash; MAY be absent even when `status === 'solved'` if confirmed via the on-chain journal. */
  fillTxHash?: string;
}

export interface SubmitTxStatusDataV2 {
  txHash: string;
  srcChainKey: string;
  status: SubmitSwapTxStatusV2;
  /** Absent from backends predating the field — treat as `'swap'`. */
  operation?: SubmitTxOperationV2;
  failedAtStep?: SubmitSwapTxStatusV2;
  failureReason?: string;
  /** Claim-time counter. */
  processingAttempts: number;
  /** ISO 8601; set when the swap exhausted its processing budget and was abandoned. */
  abandonedAt?: string;
  /** ISO 8601; set when an expired, abandoned swap was relayed for refund; the row stays abandoned. */
  relayedForRefundAt?: string;
  /** Present when solved. */
  result?: SubmitTxStatusResultV2;
  /** User-facing hint when status is failed or the swap was abandoned. */
  userMessage?: string;
  /** True when an on-chain INTENT_CANCELLED event exists for this intent (failed swaps only). */
  intentCancelled?: boolean;
}

export interface SubmitTxStatusResponseV2 {
  /** True when a record was found. */
  success: boolean;
  data: SubmitTxStatusDataV2;
}

/** Client surface of the Swaps API v2 in wire shapes. The backend `SwapsController` `implements` it (async handlers typed
 * with wire DTOs); a server-only trailing param uses the variadic-generic pattern of `IStellarSponsoringApi`. */
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

// Config API v2: static `SodaxDefaultConfig` only (client options like `fee`/`logger`/`partnerFee` never travel). Reuses
// the canonical types, projecting only its bigints (`relay.relayChainIdMap`, CL `defaultBitmap`) to decimal strings.

export type RelayConfigV2 = Omit<RelayConfig, 'relayChainIdMap'> & {
  /** SpokeChainKey → intent-relay chain id as a decimal string (e.g. `"146"`). */
  relayChainIdMap: Record<string, string>;
};

export type ConcentratedLiquidityConfigV2 = Omit<ConcentratedLiquidityConfig, 'defaultBitmap'> & {
  /** Decimal string of the bigint tick bitmap. */
  defaultBitmap: string;
};

export type DexConfigV2 = Omit<DexDefaultConfig, 'concentratedLiquidityConfig'> & {
  concentratedLiquidityConfig: ConcentratedLiquidityConfigV2;
};

/** Static config the backend serves (never merged `SodaxConfig`); only `dex` and `relay` carry bigint and are projected. */
export type SodaxConfigV2 = Omit<SodaxDefaultConfig, 'dex' | 'relay'> & {
  dex: DexConfigV2;
  relay: RelayConfigV2;
};

/** `version` is required (optional in v1); `ConfigService` rejects missing/older versions. The `_AssertJsonSafe`
 * intersection fails compilation if a `bigint` leaks into `SodaxConfigV2`. */
export type GetAllConfigResponseV2 = {
  /** Compared against the SDK's `CONFIG_VERSION`. */
  version: number;
  config: SodaxConfigV2;
} & _AssertJsonSafe<[_ContainsBigint<SodaxConfigV2>] extends [false] ? true : false>;

export type GetChainsResponseV2 = readonly string[];

export type GetSpokeChainConfigsResponseV2 = Record<string, SpokeChainConfig>;

/** Canonical `XToken` (incl. optional `access`), not `SwapTokenV2`: config mirrors the source token exactly. */
export type GetSwapTokensConfigResponseV2 = Record<string, readonly XToken[]>;

export type GetSwapTokensConfigByChainResponseV2 = readonly XToken[];

export type GetMoneyMarketTokensConfigResponseV2 = Record<string, readonly XToken[]>;

export type GetMoneyMarketTokensConfigByChainResponseV2 = readonly XToken[];

/** Hub reserve asset addresses. */
export type GetMoneyMarketReserveAssetsResponseV2 = readonly string[];

/** SpokeChainKey → intent-relay chain id (decimal string). */
export type GetRelayChainIdMapResponseV2 = Record<string, string>;

/** Client surface of the Config API v2 in wire shapes; a NestJS controller may `implements` it like {@link ISwapsApiV2}. */
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

// Kept non-exported (no knip "unused export"); checking `SodaxConfigV2` transitively covers every granular config type.
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

/** `unknown` (identity in an intersection) when `Ok` is true, else a constraint error at the use site. Callers wrap as
 * `[_ContainsBigint<T>] extends [false]` so a distributed `true | false` still resolves to `false`. */
type _AssertJsonSafe<_Ok extends true> = unknown;
