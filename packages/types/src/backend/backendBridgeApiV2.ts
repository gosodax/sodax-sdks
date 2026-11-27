// Backend Bridge API v2 wire contract (served on the swaps host). Responses are pure JSON: bigint → decimal string,
// Date → ISO string; the sole exception is the unsigned `tx` (`RawTxReturnType`), rebuilt by the SDK on parse.

import type { RawTxReturnType } from '../common/index.js';
import type { BitcoinBoundExtrasV2, PacketDataV2, PartnerFeeV2, RelayExtraDataResponseV2 } from './backendApiV2.js';

/** `XToken` projected to JSON primitives. */
export interface BridgeTokenV2 {
  symbol: string;
  name: string;
  decimals: number;
  /** Spoke-chain address, or hub address for hub tokens. */
  address: string;
  chainKey: string;
  hubAsset: string;
  /** Hub vault that custodies bridged liquidity for this token. */
  vault: string;
}

/** Keyed by SpokeChainKey. */
export type GetBridgeTokensResponseV2 = Record<string, readonly BridgeTokenV2[]>;

/** The `_AssertJsonSafe` intersection fails the build if a `bigint` leaks into `BridgeTokenV2`; it is a no-op otherwise. */
export type GetBridgeTokensByChainResponseV2 = readonly BridgeTokenV2[] &
  _AssertJsonSafe<[_ContainsBigint<BridgeTokenV2>] extends [false] ? true : false>;

/** Shared body for allowance/check, approve and intents. The SDK maps its domain
 * `srcToken`/`dstToken`/`amount`/`recipient` onto these swaps-style wire names. */
export interface CreateBridgeIntentParamsV2 {
  srcChainKey: string;
  dstChainKey: string;
  inputToken: string;
  outputToken: string;
  /** Smallest unit of the input token. */
  inputAmount: string;
  srcAddress: string;
  dstAddress: string;
  /** Compressed-hex signer public key for chains whose address can't yield it (e.g. Stacks); raw intents only. */
  srcPublicKey?: string;
  /** Bitcoin Bound (Radfi) inputs; only used for raw Bitcoin TRADING-mode intents. */
  bound?: BitcoinBoundExtrasV2;
  /** Defaults to the backend's configured `bridgePartnerFee`. */
  partnerFee?: PartnerFeeV2;
}

export interface BridgeAllowanceCheckResponseV2 {
  valid: boolean;
}

export interface BridgeApproveResponseV2 {
  tx: RawTxReturnType;
  /** Zeroes a stale allowance for tokens that reject non-zero → non-zero changes (2017 TetherToken lineage).
   * Must be mined before `tx`. */
  resetTx?: RawTxReturnType;
}

/** No `intent` struct: bridge is vault-backed, not solver-based. */
export interface CreateBridgeIntentResponseV2 {
  /** Unsigned spoke-deposit transaction. */
  tx: RawTxReturnType;
  relayData: RelayExtraDataResponseV2;
}

/** Idempotent on `(txHash, srcChainKey)`. Must carry the full `relayData`: with no `intent.creator` the backend
 * cannot rebuild the relay address, which split-tx chains (Stellar/Solana/Sui/Stacks…) need. */
export interface BridgeSubmitTxRequestV2 {
  /** 1–127 chars. */
  txHash: string;
  srcChainKey: string;
  /** 1–127 chars. */
  walletAddress: string;
  relayData: RelayExtraDataResponseV2;
}

export interface BridgeSubmitTxResponseDataV2 {
  status: 'inserted' | 'duplicate';
  message: string;
}

export interface BridgeSubmitTxResponseV2 {
  /** True also for a duplicate. */
  success: boolean;
  data: BridgeSubmitTxResponseDataV2;
}

export interface BridgeSubmitTxStatusQueryV2 {
  /** 1–127 chars. */
  txHash: string;
  srcChainKey: string;
}

/** Swaps lifecycle minus `'posting_execution'` (no solver). */
export type SubmitBridgeTxStatusV2 = 'pending' | 'relaying' | 'relayed' | 'executed' | 'failed';

/** Present when executed; terminal success is `status === 'executed' && dstIntentTxHash`. */
export interface BridgeSubmitTxStatusResultV2 {
  dstIntentTxHash: string;
  packetData?: PacketDataV2;
}

export interface BridgeSubmitTxStatusDataV2 {
  txHash: string;
  srcChainKey: string;
  /** Plain `string`, not {@link SubmitBridgeTxStatusV2}, so a future backend state never breaks parsing. */
  status: string;
  /** One of {@link SubmitBridgeTxStatusV2}, typed tolerantly as `string`. */
  failedAtStep?: string;
  failureReason?: string;
  /** Claim-time counter. */
  processingAttempts: number;
  /** ISO 8601; set when the processing budget was exhausted. */
  abandonedAt?: string;
  result?: BridgeSubmitTxStatusResultV2;
  /** User-facing hint when failed or abandoned. */
  userMessage?: string;
}

export interface BridgeSubmitTxStatusResponseV2 {
  /** True when a record was found. */
  success: boolean;
  data: BridgeSubmitTxStatusDataV2;
}

// Fee and bridgeable endpoints are computable client-side; SDK consumers should prefer the local `sodax.bridge.*`.

export interface BridgeFeeRequestV2 {
  /** Smallest unit of the input token. */
  inputAmount: string;
  /** Defaults to the backend's configured `bridgePartnerFee`. */
  partnerFee?: PartnerFeeV2;
}

/** The partner fee is a fixed %/amount of the input, independent of the token. */
export interface BridgeFeeResponseV2 {
  /** Smallest unit; `'0'` when no partner fee is configured. */
  fee: string;
}

/** Shared body for bridgeable-amount and bridgeable/check; the backend resolves each side to an XToken. */
export interface BridgeQuoteRequestV2 {
  srcChainKey: string;
  dstChainKey: string;
  inputToken: string;
  outputToken: string;
}

/** `BridgeLimit` projected to JSON. */
export interface BridgeLimitV2 {
  /** Smallest unit (decimal string). */
  amount: string;
  decimals: number;
  type: 'DEPOSIT_LIMIT' | 'WITHDRAWAL_LIMIT';
}

export interface BridgeableAmountResponseV2 {
  limit: BridgeLimitV2;
}

export interface BridgeableCheckResponseV2 {
  bridgeable: boolean;
}

/** Backend `BridgeController` `implements` this, so a wire shape cannot drift without failing its build. */
export interface IBridgeApiV2 {
  /** POST /bridge/allowance/check */
  checkAllowance(body: CreateBridgeIntentParamsV2): Promise<BridgeAllowanceCheckResponseV2>;
  /** POST /bridge/approve */
  approve(body: CreateBridgeIntentParamsV2): Promise<BridgeApproveResponseV2>;
  /** POST /bridge/intents */
  createBridgeIntent(body: CreateBridgeIntentParamsV2): Promise<CreateBridgeIntentResponseV2>;
  /** POST /bridge/submit-tx */
  submitTx(body: BridgeSubmitTxRequestV2): Promise<BridgeSubmitTxResponseV2>;
  /** GET /bridge/submit-tx/status */
  getSubmitTxStatus(query: BridgeSubmitTxStatusQueryV2): Promise<BridgeSubmitTxStatusResponseV2>;
  /** GET /bridge/tokens */
  getTokens(): Promise<GetBridgeTokensResponseV2>;
  /** GET /bridge/tokens/:chainKey */
  getTokensByChain(chainKey: string): Promise<GetBridgeTokensByChainResponseV2>;
  /** POST /bridge/fee */
  getFee(body: BridgeFeeRequestV2): Promise<BridgeFeeResponseV2>;
  /** POST /bridge/bridgeable-amount */
  getBridgeableAmount(body: BridgeQuoteRequestV2): Promise<BridgeableAmountResponseV2>;
  /** POST /bridge/bridgeable/check */
  isBridgeable(body: BridgeQuoteRequestV2): Promise<BridgeableCheckResponseV2>;
}

// Module-private copies of the non-exported swaps JSON-safety helpers, so knip sees them as used.

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

/** `unknown` when `_Ok` is `true`; otherwise the constraint fails compilation at the use site. */
type _AssertJsonSafe<_Ok extends true> = unknown;
