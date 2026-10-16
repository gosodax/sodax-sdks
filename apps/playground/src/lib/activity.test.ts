import { ChainKeys, type IntentResponseV2 } from '@sodax/dapp-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTIVITY_KEY, type Activity, loadActivity, readActivity } from './activity';

const evmAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const intent: IntentResponseV2 = {
  intentId: '42',
  creator: evmAddress,
  inputToken: '0x1111111111111111111111111111111111111111',
  outputToken: '0x2222222222222222222222222222222222222222',
  inputAmount: '99000',
  minOutputAmount: '95319',
  deadline: '2000000000',
  allowPartialFill: false,
  srcChain: '8453',
  dstChain: '900',
  srcAddress: evmAddress,
  dstAddress: evmAddress,
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
};

const activity: Activity = {
  txHash: '0xdeadbeef',
  srcChainKey: ChainKeys.BASE_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcTokenAddress: evmAddress,
  dstTokenAddress: evmAddress,
  inputAmount: '100000',
  walletAddress: evmAddress,
  recipient: evmAddress,
  summary: '0.1 USDC → USDC',
  createdAt: 1_760_000_000_000,
  intent,
  relayData: '0x00',
};

const stored = (overrides: Record<string, unknown> = {}) => JSON.stringify({ ...activity, ...overrides });

describe('readActivity', () => {
  it('carries the reviewed gross through a round trip', () => {
    expect(readActivity(stored())?.inputAmount).toBe('100000');
  });

  // Without it a restored dialog would fall back to the intent's fee-netted amount, which is the
  // regression the field exists to prevent — so a record missing it is not a record to restore.
  it('rejects a record with no reviewed amount', () => {
    expect(readActivity(stored({ inputAmount: undefined }))).toBeUndefined();
  });

  it('rejects an amount that is not a smallest-unit integer', () => {
    expect(readActivity(stored({ inputAmount: '0.1' }))).toBeUndefined();
    expect(readActivity(stored({ inputAmount: '-1' }))).toBeUndefined();
    expect(readActivity(stored({ inputAmount: 100000 }))).toBeUndefined();
  });

  // The deposit is broadcast before the relay has it, so the one thing a reload must recover is
  // whether it still needs submitting — the in-memory error that used to say so does not survive.
  it('carries relay acceptance across a reload, and defaults to not accepted', () => {
    expect(readActivity(stored({ relaySubmitted: true }))?.relaySubmitted).toBe(true);
    expect(readActivity(stored())?.relaySubmitted).toBeUndefined();
    expect(readActivity(stored({ relaySubmitted: 'yes' }))?.relaySubmitted).toBeUndefined();
  });
});

describe('loadActivity', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  const withStore = (entries: Record<string, string>) => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => entries[key] ?? null,
        removeItem: (key: string) => Reflect.deleteProperty(entries, key),
      },
    });
    return entries;
  };

  // A v1 record still holds the hash, intent and relay payload a resubmission needs. This version
  // cannot render it, which is not a reason to destroy the only trace of a broadcast deposit.
  it('leaves a superseded record in storage rather than deleting it', () => {
    const entries = withStore({ 'sodax-widget-activity-v1': stored(), [ACTIVITY_KEY]: stored() });
    expect(loadActivity()?.inputAmount).toBe('100000');
    expect(entries['sodax-widget-activity-v1']).toBeDefined();
  });
});
