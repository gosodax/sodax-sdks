import { describe, expect, it } from 'vitest';
import type { IntentResponse } from './BackendApiService.js';
import { readIntentJournalOutcome } from './detailedStatusRouting.js';

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

  it('proves nothing for an open intent', () => {
    expect(readIntentJournalOutcome(journal(true, []))).toBeUndefined();
    expect(readIntentJournalOutcome(journal(true, [fill('500')]))).toBeUndefined();
  });

  it('does not read a cancel after a partial fill as cancelled', () => {
    expect(readIntentJournalOutcome(journal(false, [fill('500'), cancel]))).toBeUndefined();
  });

  it('counts a fill too malformed to parse against a cancel', () => {
    expect(readIntentJournalOutcome(journal(false, [{ eventType: 'intent-filled' }, cancel]))).toBeUndefined();
  });

  it('needs the intent closed as well as a cancel event', () => {
    expect(readIntentJournalOutcome(journal(true, [cancel]))).toBeUndefined();
  });

  it('proves nothing for a closed intent with no terminal event', () => {
    expect(readIntentJournalOutcome(journal(false, []))).toBeUndefined();
    expect(readIntentJournalOutcome(journal(false, [null, 'intent-cancelled', { eventType: 1 }]))).toBeUndefined();
  });
});
