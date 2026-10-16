import { getIntentRelayChainId, type HttpUrl, type SpokeChainKey } from '@sodax/types';
import {
  getTransactionPackets,
  HttpRelayError,
  RELAY_REQUEST_TIMEOUT_MS,
} from '../shared/services/intentRelay/IntentRelayApiService.js';
import type { PacketData } from '../shared/types/relay-types.js';
import type { BackendSubmitTxStatusEnvelope } from './pollBackendSubmitTx.js';

/**
 * The pieces every "what happened to this source tx?" router shares, whichever feature asks.
 *
 * A feature's backend submit-tx record answers only while it is in play: with the backend path
 * opted out there is no record at all, and on the default path the client-side fallback leaves
 * behind whatever state the backend last reached. The relay packet is the second source, and
 * reading it is identical for every feature — so the read, its failure classification and the
 * budget vocabulary live here rather than once per feature.
 *
 * Deliberately NOT exported from `./index.js`: `DETAILED_STATUS_NOT_DELIVERED` is already public
 * through the swap barrel, and the SDK's root barrel re-exports both with a flat `export *`, so a
 * second path to the same name would be an ambiguous star export.
 */

/**
 * `error.context.reason` on the one lookup failure that is not a dependency outage: the relay has
 * no packet for this source tx. That covers both shapes the relayer uses — a 404 for a tx it has
 * not indexed, and a successful response with no matching delivered packet.
 *
 * The state is ambiguous by nature — a transfer still in flight and one whose tx never relayed at
 * all look identical here — so it is the only `LOOKUP_FAILED` a caller can sensibly bound with a
 * retry budget. Every other one (relay 5xx or unreachable, malformed response) is something failing
 * *right now* and should be retried until it recovers; spending a budget on those would turn a
 * transient outage into a permanently stuck read.
 *
 * It is set only when the **backend also answered** — a record, or a definitive 404. Behind a
 * backend outage a relay miss proves nothing: the record may be progressing unseen, so the failure
 * stays unbudgeted.
 */
export const DETAILED_STATUS_NOT_DELIVERED = 'relay_not_delivered';

/**
 * True when the backend gave up on a record — it failed terminally or was abandoned mid-flight.
 * Such a record never self-heals, so it routes like a 404; keep it and a transfer the client-side
 * fallback went on to complete would read `failed` forever.
 *
 * Typed on the structural envelope, not one feature's record: bridge types `status` as a tolerant
 * `string` where swaps and leverage-yield use a literal union.
 */
export function isBackendSubmitTxAbandoned(data: BackendSubmitTxStatusEnvelope<unknown>): boolean {
  return data.status === 'failed' || Boolean(data.abandonedAt);
}

/**
 * The delivered relay packet for a source tx, or why it could not be read. Untagged cause plus a
 * budgetable flag, like {@link runBackendSubmitTx}'s result: the caller owns the error vocabulary,
 * so this stays feature-agnostic.
 */
export type DeliveredPacketResult =
  | { ok: true; packet: PacketData }
  | { ok: false; cause: unknown; budgetable: boolean };

/**
 * Reads the relay packet the source tx produced, applying the same envelope, attribution and
 * delivery guards `pollForExecutedPacket` does.
 *
 * `budgetable` marks the ambiguous miss described on {@link DETAILED_STATUS_NOT_DELIVERED}, and is
 * never set unless `backendAnswered`. Bounded by the relay module's own request budget, because
 * this read is polled; an expiry is a dependency failing now, so it is not budgetable.
 */
export async function resolveDeliveredPacket(params: {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
  relayerApiEndpoint: HttpUrl;
  backendAnswered: boolean;
}): Promise<DeliveredPacketResult> {
  const { srcChainKey, srcTxHash, relayerApiEndpoint, backendAnswered } = params;
  const relayChainId = getIntentRelayChainId(srcChainKey);

  const packets = await getTransactionPackets(
    { action: 'get_transaction_packets', params: { chain_id: relayChainId.toString(), tx_hash: srcTxHash } },
    relayerApiEndpoint,
    RELAY_REQUEST_TIMEOUT_MS,
  );
  if (!packets.ok) {
    // The relayer answers 404 for a source tx it has not indexed — the same "no packet for this tx"
    // state as an empty list. Anything else (5xx, transport, parse, budget expiry) is failing now.
    const notIndexed = packets.error instanceof HttpRelayError && packets.error.status === 404;
    return { ok: false, cause: packets.error, budgetable: notIndexed && backendAnswered };
  }

  // Relay responses are not schema-validated (`parseRelayResponse` casts `response.json()`), so a
  // 200 with no `data` would otherwise throw here and be reported as ordinary in-flight latency.
  if (!packets.value?.success || !Array.isArray(packets.value.data)) {
    return { ok: false, cause: new Error('relay returned no usable transaction packets'), budgetable: false };
  }

  // A packet for another transaction would answer for the wrong transfer, so match on
  // (src_tx_hash, src_chain_id) rather than taking the first executed entry, and string-guard both
  // hashes so a malformed entry is skipped.
  const delivered = packets.value.data.find(
    packet =>
      typeof packet?.src_tx_hash === 'string' &&
      packet.src_tx_hash.toLowerCase() === srcTxHash.toLowerCase() &&
      packet.src_chain_id === Number(relayChainId) &&
      packet.status === 'executed' &&
      typeof packet.dst_tx_hash === 'string' &&
      packet.dst_tx_hash.length > 0,
  );
  if (!delivered) {
    return {
      ok: false,
      cause: new Error('relay has not delivered a packet for this source tx yet'),
      budgetable: backendAnswered,
    };
  }

  return { ok: true, packet: delivered };
}
