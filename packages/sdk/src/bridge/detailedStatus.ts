import type { BridgeSubmitTxStatusDataV2, SpokeChainKey } from '@sodax/types';
import type { DepositRecord } from '../shared/services/mpcRelay/MpcRelayApiService.js';
import type { PacketData } from '../shared/types/relay-types.js';

export type DetailedBridgeStatusKey = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
  /** Required to resolve an MPC-relay-source bridge past the hub mint. */
  dstChainKey?: SpokeChainKey;
};

/**
 * The answering source's payload, unmodified. `relay`/`mpcRelay` arms are terminal; a packet's `dst_tx_hash` is
 * the hub settlement tx for a spoke source but the destination tx for a hub source.
 */
export type DetailedBridgeStatus =
  | { source: 'backend'; data: BridgeSubmitTxStatusDataV2 }
  | { source: 'relay'; data: PacketData }
  | { source: 'mpcRelay'; data: DepositRecord };
