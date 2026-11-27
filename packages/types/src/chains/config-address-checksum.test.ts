import { describe, expect, it } from 'vitest';
import { getAddress, isAddress } from 'viem';
import * as config from '../index.js';

// viem rejects a bad EIP-55 checksum while encoding; inside a `multicall` one typo fails the whole chunk and every
// balance in it silently reads zero. Only values re-exported through `src/index.ts` are walked.
const EVM_ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

function collectEvmAddresses(root: Record<string, unknown>): { path: string; value: string }[] {
  const found: { path: string; value: string }[] = [];
  // Objects are shared by reference across the config, so each is reported once, under *a* path rather than every
  // path that reaches it.
  const visited = new WeakSet<object>();

  function walk(value: unknown, path: string): void {
    if (typeof value === 'string') {
      if (EVM_ADDRESS_SHAPE.test(value)) found.push({ path, value });
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const [index, entry] of value.entries()) walk(entry, `${path}[${index}]`);
      return;
    }
    for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
  }

  for (const [key, value] of Object.entries(root)) walk(value, key);
  return found;
}

describe('EVM addresses in config carry a valid EIP-55 checksum', () => {
  const addresses = collectEvmAddresses(config as Record<string, unknown>);

  it('finds EVM addresses to check', () => {
    // Guards against the traversal silently going blind (a barrel change, a frozen namespace).
    expect(addresses.length).toBeGreaterThan(0);
  });

  it('every EVM address is accepted by viem', () => {
    const invalid = addresses.filter(({ value }) => !isAddress(value));
    expect(
      invalid,
      `config value(s) whose EIP-55 checksum does not verify:\n${invalid
        .map(({ path, value }) => `  ${path}: '${value}' -> '${getAddress(value.toLowerCase())}'`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

describe('the checksum invariant itself', () => {
  // Anchored so it never matches a non-EVM identifier (re-casing one would corrupt it); a false positive means
  // tightening the traversal, never the config.
  const VALID = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6';
  const MIS_CASED = '0x1BFD67037B42Cf73acF2047067bd4F2C47D9bfD6';

  it('accepts a correctly checksummed address', () => {
    expect(isAddress(VALID)).toBe(true);
  });

  it('rejects the same address with one flipped case', () => {
    expect(EVM_ADDRESS_SHAPE.test(MIS_CASED)).toBe(true);
    expect(isAddress(MIS_CASED)).toBe(false);
  });

  it('accepts an all-lowercase address, which the config uses for hub-side fields', () => {
    expect(isAddress(VALID.toLowerCase())).toBe(true);
  });
});
