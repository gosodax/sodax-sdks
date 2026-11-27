import { getIntentRelayChainId, type HttpUrl, type SpokeChainKey } from '@sodax/types';
import * as v from 'valibot';
import {
  getTransactionPackets,
  HttpRelayError,
  RELAY_REQUEST_TIMEOUT_MS,
} from '../shared/services/intentRelay/IntentRelayApiService.js';
import type { DepositRecord } from '../shared/services/mpcRelay/MpcRelayApiService.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import type { PacketData } from '../shared/types/relay-types.js';
import { IntentEventTypeSchema } from './backendApiSchemas.js';
import type { IntentResponse } from './BackendApiService.js';
import { isFillEvent } from './guards.js';
import type { BackendSubmitTxStatusEnvelope } from './pollBackendSubmitTx.js';

// Not exported from `./index.js`: the swap barrel already exports `DETAILED_STATUS_NOT_DELIVERED`, and a second
// path through the root `export *` would be ambiguous.

/**
 * Relay has no packet for this source tx (404 or no matching delivered packet): the only budgetable `LOOKUP_FAILED`,
 * set only when the backend also answered; other failures are outages and should retry unbounded.
 */
export const DETAILED_STATUS_NOT_DELIVERED = 'relay_not_delivered';

/** A failed/abandoned record never self-heals, so it routes like a 404 (else a fallback-completed transfer reads `failed`). */
export function isBackendSubmitTxAbandoned(data: BackendSubmitTxStatusEnvelope<unknown>): boolean {
  return data.status === 'failed' || Boolean(data.abandonedAt);
}

export type IntentJournalOutcome = { kind: 'solved'; fillTxHash: string } | { kind: 'cancelled' };

/**
 * `solved` needs the fill with `remainingInput === '0'`; `cancelled` needs a cancel with no `intent-filled` at all.
 * Uses the journal, not hub `intentStates`, which deletes the entry on both full fill and cancel.
 */
export function readIntentJournalOutcome(intent: IntentResponse): IntentJournalOutcome | undefined {
  const settled = intent.events.filter(isFillEvent).find(fill => fill.intentState.remainingInput === '0');
  if (settled) return { kind: 'solved', fillTxHash: settled.txHash };

  const eventTypes = intent.events.flatMap(event => (v.is(IntentEventTypeSchema, event) ? [event.eventType] : []));
  if (!intent.open && eventTypes.includes('intent-cancelled') && !eventTypes.includes('intent-filled')) {
    return { kind: 'cancelled' };
  }
  return undefined;
}

/** Untagged cause plus a budgetable flag: the caller owns the error vocabulary. */
export type DeliveredPacketResult =
  | { ok: true; packet: PacketData }
  | { ok: false; cause: unknown; budgetable: boolean };

/** Same guards as `pollForExecutedPacket`; `budgetable` is never set unless `backendAnswered`, and expiry isn't budgetable. */
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
    // 404 means "not indexed", same as an empty list; anything else is failing now.
    const notIndexed = packets.error instanceof HttpRelayError && packets.error.status === 404;
    return { ok: false, cause: packets.error, budgetable: notIndexed && backendAnswered };
  }

  // Relay responses aren't schema-validated, so a 200 with no `data` would otherwise throw here.
  if (!packets.value?.success || !Array.isArray(packets.value.data)) {
    return { ok: false, cause: new Error('relay returned no usable transaction packets'), budgetable: false };
  }

  // Match on (src_tx_hash, src_chain_id) so another tx's packet can't answer for this transfer.
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

export type DeliveredHubTxResult = { ok: true; hubTxHash: string } | { ok: false; cause: unknown; budgetable: boolean };

export type MintedDepositResult =
  | { ok: true; deposit: DepositRecord; hubTxHash: string }
  | { ok: false; cause: unknown; budgetable: boolean };

/** `undefined` for intent-relay chains; an unminted deposit is budgetable since the relay reports unknown ones as `pending`. */
export async function resolveMintedMpcDeposit(params: {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
  backendAnswered: boolean;
  spoke: SpokeService;
}): Promise<MintedDepositResult | undefined> {
  const deposit = await params.spoke.getMpcRelayDeposit(params.srcChainKey, params.srcTxHash);
  if (!deposit) return undefined;
  if (!deposit.ok) return { ok: false, cause: deposit.error, budgetable: false };

  const { status, txs } = deposit.value;
  const hubMint = txs?.hubMint?.hash;
  if ((status === 'minted' || status === 'swept') && hubMint) {
    return { ok: true, deposit: deposit.value, hubTxHash: hubMint };
  }
  return {
    ok: false,
    cause: new Error(`mpc relay has not minted this deposit on the hub yet (status: ${status})`),
    budgetable: params.backendAnswered,
  };
}

export type PaidHubReleaseResult =
  | { ok: true; release: DepositRecord }
  | { ok: false; cause: unknown; budgetable: boolean };

/**
 * `undefined` when the hub tx sends no MPC-relay release; the intent relay has no packet for it (hub emits `BridgeRequest`).
 * An unpaid release is budgetable since the relay reports unknown ones as `pending`.
 */
export async function resolvePaidHubRelease(params: {
  hubTxHash: string;
  backendAnswered: boolean;
  spoke: SpokeService;
}): Promise<PaidHubReleaseResult | undefined> {
  const release = await params.spoke.getHubRelease(params.hubTxHash);
  if (!release) return undefined;
  if (!release.ok) return { ok: false, cause: release.error, budgetable: false };
  if (release.value.txs?.release?.hash) return { ok: true, release: release.value };
  return {
    ok: false,
    cause: new Error(`mpc relay has not paid out the release from hub tx ${params.hubTxHash} yet`),
    budgetable: params.backendAnswered,
  };
}

/** Minted deposit on an MPC-relay chain, delivered packet on any other. */
export async function resolveDeliveredHubTxHash(params: {
  srcChainKey: SpokeChainKey;
  srcTxHash: string;
  relayerApiEndpoint: HttpUrl;
  backendAnswered: boolean;
  spoke: SpokeService;
}): Promise<DeliveredHubTxResult> {
  const minted = await resolveMintedMpcDeposit(params);
  if (minted) return minted.ok ? { ok: true, hubTxHash: minted.hubTxHash } : minted;

  const delivered = await resolveDeliveredPacket(params);
  return delivered.ok ? { ok: true, hubTxHash: delivered.packet.dst_tx_hash } : delivered;
}
