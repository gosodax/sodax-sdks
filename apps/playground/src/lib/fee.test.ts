import { describe, expect, it } from 'vitest';
import { FEE_BPS_MAX, NO_PARTNER_FEE, effectiveFeeState, feeAmountOf, readPartnerFee } from './fee';

const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';

describe('readPartnerFee', () => {
  it('is none when the form is untouched', () => {
    expect(readPartnerFee(NO_PARTNER_FEE)).toEqual({ kind: 'none' });
  });

  it('reads a complete form into the percentage form of PartnerFee', () => {
    expect(readPartnerFee({ address: RECIPIENT, bps: '25' })).toEqual({
      kind: 'set',
      fee: { address: RECIPIENT, percentage: 25 },
    });
  });

  it('trims surrounding whitespace on both halves', () => {
    expect(readPartnerFee({ address: ` ${RECIPIENT} `, bps: ' 25 ' })).toEqual({
      kind: 'set',
      fee: { address: RECIPIENT, percentage: 25 },
    });
  });

  it('is none rather than a zero fee when the rate is zero', () => {
    expect(readPartnerFee({ address: RECIPIENT, bps: '0' })).toEqual({ kind: 'none' });
  });

  // Half-filled must not fall back to "no fee": quoting without the fee the swap charges leaves a
  // minOutputAmount the intent cannot deliver.
  it.each([
    ['a rate with no recipient', { address: '', bps: '25' }],
    ['a recipient with no rate', { address: RECIPIENT, bps: '' }],
  ])('rejects %s', (_label, input) => {
    expect(readPartnerFee(input).kind).toBe('invalid');
  });

  it.each([
    ['a non-EVM address', { address: 'sonic1abc', bps: '25' }],
    ['a truncated address', { address: '0x1234', bps: '25' }],
    ['a fractional rate', { address: RECIPIENT, bps: '2.5' }],
    ['a negative rate', { address: RECIPIENT, bps: '-5' }],
    ['a rate above the maximum', { address: RECIPIENT, bps: String(FEE_BPS_MAX + 1) }],
  ])('rejects %s', (_label, input) => {
    expect(readPartnerFee(input).kind).toBe('invalid');
  });

  it('accepts the documented maximum', () => {
    expect(readPartnerFee({ address: RECIPIENT, bps: String(FEE_BPS_MAX) }).kind).toBe('set');
  });
});

describe('feeAmountOf', () => {
  it('is zero without a fee', () => {
    expect(feeAmountOf(1_000_000n, undefined)).toBe(0n);
  });

  it('takes basis points off the input', () => {
    expect(feeAmountOf(1_000_000n, { address: RECIPIENT, percentage: 100 })).toBe(10_000n);
  });

  it('truncates rather than rounding, so the fee never exceeds the rate', () => {
    expect(feeAmountOf(999n, { address: RECIPIENT, percentage: 1 })).toBe(0n);
  });
});

describe('effectiveFeeState', () => {
  const set = readPartnerFee({ address: '0x1234567890abcdef1234567890abcdef12345678', bps: '50' });
  const invalid = readPartnerFee({ address: '', bps: '50' });

  it('sends no fee when the URL carries a key, even over a set or invalid deployment fee', () => {
    expect(effectiveFeeState('test_key-0123456789', set)).toEqual({ kind: 'none' });
    expect(effectiveFeeState('test_key-0123456789', invalid)).toEqual({ kind: 'none' });
  });

  it('keeps the deployment fee when the URL has no key', () => {
    expect(effectiveFeeState(undefined, set)).toBe(set);
    expect(effectiveFeeState(undefined, invalid)).toBe(invalid);
  });
});
