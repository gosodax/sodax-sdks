import type { EvmHubProvider } from '../entities/EvmHubProvider.js';
export type { RelayExtraData, OnDemandRelayData } from './relay-types.js';
import type { RelayExtraData } from './relay-types.js';
import type { DepositReturnType, MpcRelayChainKey, SendMessageReturnType, SpokeChainKey } from '@sodax/types';
import type { SettlementDirection } from './spoke-types.js';

/**
 * Types derived from Core SDK specific types
 * NOTE: common (non Core SDK specific) types should be put in @sodax/types package
 */

export type HubProvider = EvmHubProvider;

export type RateLimitConfig = {
  maxAvailable: number;
  ratePerSecond: number;
  available: number;
};

/**
 * Structural types
 */
export type OptionalRaw<R extends boolean> = { raw?: R };
export type OptionalSkipSimulation = { skipSimulation?: boolean };
export type OptionalTimeout = { timeout?: number };

export type TxHashPair = {
  srcChainTxHash: string; // tx hash on the source chain (usually spoke chain)
  dstChainTxHash: string; // tx hash on the destination chain (usually hub chain)
};

/**
 * How an MPC-relay withdraw-auth (a borrow or withdraw from Tron) settled. The source chain has no tx for
 * it, only the relay's `trackingId`, so it is not a {@link TxHashPair}: never link `trackingId` to an
 * explorer. `dstChainTxHash` is the far side, as in a pair: the payout tx, or the hub tx when it ends there.
 */
export type MpcWithdrawalSettlement = { trackingId: string; dstChainTxHash: string };

/** What an outbound action (borrow, withdraw) from `K` settles to; a union for a union of chain keys. */
export type OutboundSettlement<K extends SpokeChainKey> = K extends MpcRelayChainKey
  ? MpcWithdrawalSettlement
  : TxHashPair;

/** What {@link SpokeService.settle} resolves to: only an outbound action from an MPC-relay chain has no tx pair. */
export type Settlement<K extends SpokeChainKey, D extends SettlementDirection> = D extends 'outbound'
  ? OutboundSettlement<K>
  : TxHashPair;

/** The spoke operation behind a feature action: a deposit into the hub, or a message to it (borrow, withdraw). */
export type SpokeOperation = 'deposit' | 'sendMessage';

/** What `Op` returns on `K`; the two differ only on Tron ({@link DepositReturnType}, {@link SendMessageReturnType}). */
export type SpokeOperationReturnType<
  K extends SpokeChainKey,
  Raw extends boolean,
  Op extends SpokeOperation,
> = Op extends 'deposit' ? DepositReturnType<K, Raw> : SendMessageReturnType<K, Raw>;

/** A created action's spoke tx and relay data; `Op` narrows `tx` to the operation the action performs. */
export type IntentTxResult<K extends SpokeChainKey, Raw extends boolean, Op extends SpokeOperation = SpokeOperation> = {
  tx: SpokeOperationReturnType<K, Raw, Op>;
  relayData: RelayExtraData;
};

export type { RawDestinationParams } from './spoke-types.js';
import type { RawDestinationParams } from './spoke-types.js';
export type DestinationParamsType = RawDestinationParams;
