import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { isTimeoutError, toMystenTransaction } from './sui-utils.js';
import { invariant } from './tiny-invariant.js';

const SENDER = `0x${'11'.repeat(32)}`;
const PACKAGE = `0x${'22'.repeat(32)}`;
const STATE = `0x${'33'.repeat(32)}`;
const COIN = `0x${'44'.repeat(32)}`;

/** A PTB shaped like `SuiSpokeService.deposit`: split, merge, object + pure args, a move call. */
const makeDepositLikeTx = (): Transaction => {
  const tx = new Transaction();
  tx.mergeCoins(COIN, [`0x${'55'.repeat(32)}`]);
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1_000_000n)]);
  invariant(coin, 'splitCoins returned no coin');
  tx.moveCall({
    target: `${PACKAGE}::asset_manager::transfer`,
    typeArguments: ['0x2::sui::SUI'],
    arguments: [tx.object(STATE), coin, tx.pure(bcs.vector(bcs.u8()).serialize(fromHex('0xdeadbeef', 'bytes')))],
  });
  return tx;
};

/**
 * `Argument` carries an in-memory `type: 'object' | 'pure'` hint that the JSON plan does not encode
 * — the inputs it points at are self-describing, so a rebuilt transaction has the hint stripped.
 */
const stripArgumentTypeHints = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripArgumentTypeHints);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key, entry]) => !(key === 'type' && (entry === 'object' || entry === 'pure')),
  );
  return Object.fromEntries(entries.map(([key, entry]) => [key, stripArgumentTypeHints(entry)]));
};

describe('toMystenTransaction', () => {
  it('returns a Transaction untouched', async () => {
    const tx = new Transaction();
    await expect(toMystenTransaction(tx)).resolves.toBe(tx);
  });

  it('rebuilds a transaction that only exposes toJSON()', async () => {
    const source = new Transaction();
    source.setSender(SENDER);
    const json = await source.toJSON();

    const rebuilt = await toMystenTransaction({ toJSON: () => Promise.resolve(json) });

    expect(rebuilt).toBeInstanceOf(Transaction);
    await expect(rebuilt.toJSON()).resolves.toBe(json);
  });

  it('round-trips a real PTB — the JSON plan, its inputs and its commands all survive', async () => {
    const source = makeDepositLikeTx();
    source.setSender(SENDER);
    const json = await source.toJSON();

    const rebuilt = await toMystenTransaction({ toJSON: () => Promise.resolve(json) });

    // The JSON is the plan the client builds and the wallet signs — a stable round-trip is what the
    // raw-transaction path (`tx.serialize()` → `Transaction.from()`) has always relied on.
    await expect(rebuilt.toJSON()).resolves.toBe(json);
    expect(rebuilt.getData().inputs).toEqual(source.getData().inputs);
    expect(rebuilt.getData().sender).toBe(SENDER);
    expect(rebuilt.getData().commands).toEqual(source.getData().commands.map(stripArgumentTypeHints));
  });

  it('leaves the caller transaction alone when it rebuilds — the sender lands on the copy', async () => {
    const source = makeDepositLikeTx();
    const json = await source.toJSON();

    const rebuilt = await toMystenTransaction({ toJSON: () => Promise.resolve(json) });
    rebuilt.setSenderIfNotSet(SENDER);

    expect(rebuilt.getData().sender).toBe(SENDER);
    expect(source.getData().sender).toBeNull();
  });
});

describe('isTimeoutError', () => {
  it('matches the Node AbortSignal.timeout reason', () => {
    expect(isTimeoutError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(true);
  });

  it('matches the browser AbortSignal.timeout reason, whose message says nothing about "timeout"', () => {
    expect(isTimeoutError({ name: 'TimeoutError', message: 'signal timed out' })).toBe(true);
  });

  it('matches an explicit abort', () => {
    expect(isTimeoutError(new DOMException('This operation was aborted', 'AbortError'))).toBe(true);
  });

  it('falls back to the message for errors rethrown without a name', () => {
    expect(isTimeoutError(new Error('waitForTransaction timeout exceeded'))).toBe(true);
  });

  it('does not match unrelated failures', () => {
    expect(isTimeoutError(new Error('connection refused'))).toBe(false);
    expect(isTimeoutError('boom')).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
  });
});
