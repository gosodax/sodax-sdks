import { describe, expect, it } from 'vitest';
import { getAddress, isAddress } from 'viem';
import * as config from '../index.js';

// A mixed-case EVM address whose EIP-55 checksum does not verify is rejected while viem encodes
// calldata, before any RPC call. On its own that is a loud throw (a deposit/transfer fails to
// build), but inside a `multicall` the bad address lands in the `aggregate3` tuple, which is
// encoded after the per-call try/catch — so one typo rejects the whole chunk and, with viem's
// default `allowFailure: true`, every balance in it degrades to a silent zero.
//
// Scope note: this walks the values reachable from the package barrel. A config value that is not
// re-exported through `src/index.ts` is invisible here — which the "re-export through the
// subdirectory barrel" rule in AGENTS.md is what keeps true.
const EVM_ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

function collectEvmAddresses(root: Record<string, unknown>): { path: string; value: string }[] {
  const found: { path: string; value: string }[] = [];
  // Objects are shared by reference across the config (the same token entry appears in
  // `supportedTokensByChain` and in the feature lists), so a visited-set keeps each value reported
  // once. The reported path is therefore *a* path to the offender, not its only one.
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
  // The shape predicate is anchored so it never matches a non-EVM identifier (Icon `cx…`, Stellar
  // `G…`, Solana base58, Sui's 0x + 64 hex, or the `vault: '0x'` placeholders) — re-casing one of
  // those would corrupt it. A false positive means tightening the traversal, never the config.
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
