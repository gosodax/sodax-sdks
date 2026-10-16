/** The tagged status union behind `BridgeService.getDetailedStatus`. Pure — no I/O. */

import type { BridgeSubmitTxStatusDataV2, SpokeChainKey } from '@sodax/types';
import type { PacketData } from '../shared/types/relay-types.js';

/** The identity a detailed status is read for — the backend submit-tx record's key. */
export type DetailedBridgeStatusKey = {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
};

/**
 * Which of the two existing status sources answered, with that source's payload unmodified.
 * A router, not a merge — see `docs/BRIDGE.md` § Get Detailed Status.
 *
 * The relay arm carries the matched packet whole rather than hoisting a hash out of it, because
 * `dst_tx_hash` means different things by route: for a spoke-source bridge it is the **hub
 * settlement** tx, and for a hub-source one it is the destination spoke's tx. No single field name
 * would be true in both directions, so the caller reads it off the packet with the packet's own
 * semantics. It is always an `executed` packet with a non-empty `dst_tx_hash` — the router does not
 * return any other kind — so this arm is terminal.
 */
export type DetailedBridgeStatus =
  | { source: 'backend'; data: BridgeSubmitTxStatusDataV2 }
  | { source: 'relay'; data: PacketData };
