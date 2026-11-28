import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpokeChainKey } from '@sodax/types';
import { Sodax } from '../shared/entities/Sodax.js';
import * as IntentRelayApiService from '../shared/services/intentRelay/IntentRelayApiService.js';
import type { DepositRecord } from '../shared/services/mpcRelay/MpcRelayApiService.js';
import type { IntentResponse } from './BackendApiService.js';
import { readIntentJournalOutcome, resolveDeliveredHubTxHash } from './detailedStatusRouting.js';

const journal = (open: boolean, events: unknown[]): IntentResponse => ({
  intentHash: '0x82cd1da49cb359107181167abf53e876944a763243aeb3a78f75fe9b4ba73240',
  txHash: '0xb723dd7b2b8c1849d51e2f4164be5ac371efa1704da754773b633faa7625d988',
  logIndex: 3,
  chainId: 146,
  blockNumber: 80984466,
  open,
  intent: {
    intentId: '1',
    creator: '0xcreator',
    inputToken: '0xin',
    outputToken: '0xout',
    inputAmount: '1121000',
    minOutputAmount: '439485873350153',
    deadline: '1791963740',
    allowPartialFill: true,
    srcChain: 30,
    dstChain: 30,
    srcAddress: '0xsrc',
    dstAddress: '0xdst',
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
  events,
});

// The live shape of the cancelled intent behind the issue this guards.
const cancel = {
  eventType: 'intent-cancelled',
  txHash: '0x4267c7be8d77770813195bd94118da0830e261f4142cfc48c966c1a11563a052',
  logIndex: 2,
  blockNumber: 80984744,
};
const fill = (remainingInput: string) => ({
  eventType: 'intent-filled',
  txHash: '0xfill',
  intentState: { remainingInput },
});

describe('readIntentJournalOutcome', () => {
  it('reads a closed intent with a cancel and no fill as cancelled', () => {
    expect(readIntentJournalOutcome(journal(false, [cancel]))).toEqual({ kind: 'cancelled' });
  });

  it('reads the fill that consumed the remainder as solved', () => {
    expect(readIntentJournalOutcome(journal(false, [fill('0')]))).toEqual({ kind: 'solved', fillTxHash: '0xfill' });
  });

  it('proves nothing for an open intent, a cancel after a non-final fill, or a closed intent with no terminal event', () => {
    const cases: [string, IntentResponse][] = [
      ['open, no events', journal(true, [])],
      ['open, partial fill', journal(true, [fill('500')])],
      ['open, carrying a cancel', journal(true, [cancel])],
      ['cancel after a partial fill', journal(false, [fill('500'), cancel])],
      ['cancel after a fill too malformed to parse', journal(false, [{ eventType: 'intent-filled' }, cancel])],
      ['closed, no events', journal(false, [])],
      ['closed, no well-formed terminal event', journal(false, [null, 'intent-cancelled', { eventType: 1 }])],
    ];
    for (const [label, response] of cases) {
      expect(readIntentJournalOutcome(response), label).toBeUndefined();
    }
  });
});

describe('resolveDeliveredHubTxHash', () => {
  const spoke = new Sodax().spoke;
  const TRON = 'tron' satisfies SpokeChainKey;
  const SRC_TX = '9022a4a1d99f86401e165bd55aa2076f2df5c7f8028c5f5363b4096d264f5d4f';
  const HUB_MINT = '0x6c627c5124b9cc3f4f64b62a0aad144178388647cb819633b05863716bce3437';
  const params = (srcChainKey: SpokeChainKey, backendAnswered = true) => ({
    srcChainKey,
    srcTxHash: SRC_TX,
    relayerApiEndpoint: 'https://relay.example' as const,
    backendAnswered,
    spoke,
  });
  const deposit = (status: DepositRecord['status'], txs: DepositRecord['txs'] = {}) => ({
    ok: true as const,
    value: { depositId: 'id', status, createdAt: 0, txs },
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads an MPC-relay source from its minted (or swept, past minted) deposit record and never asks the intent relay', async () => {
    const packets = vi.spyOn(IntentRelayApiService, 'getTransactionPackets');
    const getDepositRecord = vi
      .spyOn(spoke.tron, 'getDepositRecord')
      .mockResolvedValueOnce(deposit('minted', { hubMint: { chain: '146', hash: HUB_MINT, ts: 0 } }))
      .mockResolvedValueOnce(deposit('swept', { hubMint: { chain: '146', hash: HUB_MINT, ts: 0 } }));

    expect(await resolveDeliveredHubTxHash(params(TRON))).toEqual({ ok: true, hubTxHash: HUB_MINT });
    expect(await resolveDeliveredHubTxHash(params(TRON))).toEqual({ ok: true, hubTxHash: HUB_MINT });
    expect(getDepositRecord).toHaveBeenCalledWith(SRC_TX);
    expect(packets).not.toHaveBeenCalled();
  });

  it('reads an unminted deposit, or a minted one without a hub mint hash, as the not-delivered miss — budgetable only when the backend answered', async () => {
    vi.spyOn(spoke.tron, 'getDepositRecord')
      .mockResolvedValueOnce(deposit('attested'))
      .mockResolvedValueOnce(deposit('attested'))
      .mockResolvedValueOnce(deposit('minted'));

    expect(await resolveDeliveredHubTxHash(params(TRON, true))).toMatchObject({ ok: false, budgetable: true });
    expect(await resolveDeliveredHubTxHash(params(TRON, false))).toMatchObject({ ok: false, budgetable: false });
    expect(await resolveDeliveredHubTxHash(params(TRON))).toMatchObject({ ok: false, budgetable: true });
  });

  it('treats a failed deposit read as a dependency failing now, never budgetable', async () => {
    const cause = new Error('mpc-relay: 503');
    vi.spyOn(spoke.tron, 'getDepositRecord').mockResolvedValue({ ok: false, error: cause });

    expect(await resolveDeliveredHubTxHash(params(TRON))).toEqual({ ok: false, cause, budgetable: false });
  });

  it('keeps an intent-relay source on its relay packet', async () => {
    const getDepositRecord = vi.spyOn(spoke.tron, 'getDepositRecord');
    const packet = { src_tx_hash: SRC_TX, src_chain_id: 23, status: 'executed', dst_tx_hash: HUB_MINT };
    // Only the packet fields the attribution guard reads; a real PacketData carries more.
    const response = { ok: true, value: { success: true, data: [packet] } } as unknown as Awaited<
      ReturnType<typeof IntentRelayApiService.getTransactionPackets>
    >;
    const packets = vi.spyOn(IntentRelayApiService, 'getTransactionPackets').mockResolvedValue(response);

    expect(await resolveDeliveredHubTxHash(params('0xa4b1.arbitrum'))).toEqual({ ok: true, hubTxHash: HUB_MINT });
    expect(packets).toHaveBeenCalled();
    expect(getDepositRecord).not.toHaveBeenCalled();
  });
});
