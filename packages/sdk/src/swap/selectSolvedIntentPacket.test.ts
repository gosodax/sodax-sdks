import { describe, it, expect } from 'vitest';
import type { Address } from 'viem';
import type { PacketData } from '../shared/types/relay-types.js';
import { decodePacketIntentTarget, selectSolvedIntentPacket } from './selectSolvedIntentPacket.js';

const INTENTS_CONTRACT = '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef' as Address;

// Real `get_transaction_packets` response for fill tx
// 0xf113095ccbadfefbf7bc8b62eb1c894d75ca485843b9bbd351c4a2f78b94ce61 — two packets sharing the
// same src_tx_hash. The correct (user-facing IntentFilled delivery) packet is conn_sn 174635,
// whose payload field[1] is the hub intents contract.
const WRONG_PACKET: PacketData = {
  src_chain_id: 146,
  src_tx_hash: '0xf113095ccbadfefbf7bc8b62eb1c894d75ca485843b9bbd351c4a2f78b94ce61',
  src_address: '60c5681bd1db4e50735c4ca3386005a4ba4937c0',
  status: 'executed',
  dst_chain_id: 26745,
  conn_sn: 174634,
  dst_address: 'afd6a6e4287a511d3baad013093815268846fbb7',
  dst_tx_hash: '0x29dd2ae8a3c6e1a4ed791aca307a8754fc3951b2f067564f38e40e49f435cc54',
  signatures: ['251a768b', 'f6195143'],
  payload:
    'f84594b8ce59fc3717ada4c02eadf9682a9e934f625ebb94c3391bdecf3f5c40bf2e1b30606b60d3f22bf96294b8cf53018fe6b7e64ebd3994854f3902782e609084022d986580',
};

const CORRECT_PACKET: PacketData = {
  src_chain_id: 146,
  src_tx_hash: '0xf113095ccbadfefbf7bc8b62eb1c894d75ca485843b9bbd351c4a2f78b94ce61',
  src_address: '60c5681bd1db4e50735c4ca3386005a4ba4937c0',
  status: 'executed',
  dst_chain_id: 26745,
  conn_sn: 174635,
  dst_address: 'afd6a6e4287a511d3baad013093815268846fbb7',
  dst_tx_hash: '0xcc4cc5b6977d98909696859d0d6b9c967f573ea87d9503ab960b8f22c2db79f4',
  signatures: ['509f7cfc', '383665d7'],
  payload:
    'f849940000000000000000000000000000000000000000946382d6ccd780758c5e8a6123c33ee8f4472f96ef942cface8c74bd6861a2b5d499a7f4677f1a1a022b88076208b8314b2be980',
};

describe('decodePacketIntentTarget', () => {
  it('decodes payload field[1] to the packet target, with or without a 0x prefix', () => {
    expect(decodePacketIntentTarget(CORRECT_PACKET.payload)).toBe('0x6382d6ccd780758c5e8a6123c33ee8f4472f96ef');
    expect(decodePacketIntentTarget(`0x${CORRECT_PACKET.payload}`)).toBe('0x6382d6ccd780758c5e8a6123c33ee8f4472f96ef');
    expect(decodePacketIntentTarget(WRONG_PACKET.payload)).toBe('0xc3391bdecf3f5c40bf2e1b30606b60d3f22bf962');
  });

  it('returns undefined for a malformed payload (no throw)', () => {
    expect(decodePacketIntentTarget('not-hex')).toBeUndefined();
    expect(decodePacketIntentTarget('')).toBeUndefined();
  });
});

describe('selectSolvedIntentPacket', () => {
  it('selects the packet targeting the hub intents contract (user-facing delivery), in any order and case', () => {
    const selected = selectSolvedIntentPacket([WRONG_PACKET, CORRECT_PACKET], INTENTS_CONTRACT);
    expect(selected?.dst_tx_hash).toBe('0xcc4cc5b6977d98909696859d0d6b9c967f573ea87d9503ab960b8f22c2db79f4');
    expect(selected?.conn_sn).toBe(174635);

    expect(selectSolvedIntentPacket([CORRECT_PACKET, WRONG_PACKET], INTENTS_CONTRACT)?.conn_sn).toBe(174635);
    expect(
      selectSolvedIntentPacket([WRONG_PACKET, CORRECT_PACKET], INTENTS_CONTRACT.toLowerCase() as Address)?.conn_sn,
    ).toBe(174635);
  });

  it('returns the only candidate of a single-element array (legacy passthrough), and undefined for none', () => {
    expect(selectSolvedIntentPacket([WRONG_PACKET], INTENTS_CONTRACT)).toBe(WRONG_PACKET);
    expect(selectSolvedIntentPacket([], INTENTS_CONTRACT)).toBeUndefined();
  });

  it('falls back to the highest conn_sn when no candidate targets the intents contract', () => {
    const other: PacketData = { ...WRONG_PACKET, conn_sn: 100, dst_tx_hash: '0xother' };
    const selected = selectSolvedIntentPacket([WRONG_PACKET, other], INTENTS_CONTRACT);
    expect(selected?.conn_sn).toBe(174634);
    expect(selected?.dst_tx_hash).toBe(WRONG_PACKET.dst_tx_hash);
  });
});
