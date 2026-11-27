import * as rlp from 'rlp';
import type { Address } from 'viem';
import type { PacketData } from '../shared/types/relay-types.js';

/** RLP field[1] (the message target) as lowercase hex, or `undefined` if malformed. Never throws. */
export function decodePacketIntentTarget(payload: string): string | undefined {
  try {
    const hex = payload.startsWith('0x') ? payload.slice(2) : payload;
    const decoded = rlp.decode(Buffer.from(hex, 'hex')) as unknown as Uint8Array[];
    const field1 = decoded?.[1];
    if (!field1 || field1.length === 0) return undefined;
    return `0x${Buffer.from(field1).toString('hex')}`.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * A fill emits several packets; the user's delivery targets the intents contract (others are internal hops).
 * Fallbacks (single candidate, else highest `conn_sn`) assume the relayer returns a fill's packets together.
 */
export function selectSolvedIntentPacket(packets: PacketData[], intentsContract: Address): PacketData | undefined {
  if (packets.length <= 1) return packets[0];
  const target = intentsContract.toLowerCase();
  const matched = packets.find(packet => decodePacketIntentTarget(packet.payload) === target);
  if (matched) return matched;
  return packets.reduce((highest, packet) => (packet.conn_sn > highest.conn_sn ? packet : highest));
}
