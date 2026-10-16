import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { getStellarAccountActiveQueryOptions } from './useStellarAccountActive.js';
import { getStellarAccountStatusQueryOptions } from './useStellarAccountStatus.js';

// The mutation contract test cannot verify invalidation keys, so compare them with query factories here.
const SRC = readFileSync(resolve(fileURLToPath(import.meta.url), '..', 'useActivateStellarAccount.ts'), 'utf8');

const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function invalidatedKeyPrefixes(): string[][] {
  return [...SRC.matchAll(/invalidateQueries\(\{\s*queryKey:\s*\[([^\]]*)\]/g)].map(match =>
    (match[1] ?? '')
      .split(',')
      .map(segment => segment.trim())
      .filter(segment => segment.length > 0)
      // Runtime key segments are excluded because this helper compares literal prefixes.
      .filter(segment => /^'[^']*'$/.test(segment))
      .map(segment => segment.slice(1, -1)),
  );
}

describe('useActivateStellarAccount — cache invalidation', () => {
  it('hand-rolls exactly three query invalidations on success, the fourth routed through invalidateBalances', () => {
    expect(invalidatedKeyPrefixes()).toHaveLength(3);
  });

  it("invalidates the account-active query using that query's own key prefix", () => {
    const { sodax } = {
      sodax: { sponsoring: { isStellarAccountActive: vi.fn(async () => ({ ok: true as const, value: true })) } },
    };
    const produced = getStellarAccountActiveQueryOptions({ sodax, address: ADDRESS }).queryKey;
    const expected = produced.slice(0, -1);

    expect(invalidatedKeyPrefixes()).toContainEqual(expected);
  });

  it("invalidates the account-status query using that query's own key prefix", () => {
    // The status and active checks use independent cache entries.
    const sodax = {
      sponsoring: {
        getStellarAccountStatus: vi.fn(async () => ({
          ok: true as const,
          value: {
            exists: true,
            nativeBalanceStroops: 0n,
            availableBalanceStroops: 0n,
            canAffordTrustline: false,
            trustlineMinXlmStroops: 5_100_000n,
          },
        })),
      },
    };
    const produced = getStellarAccountStatusQueryOptions({ sodax, address: ADDRESS }).queryKey;

    expect(invalidatedKeyPrefixes()).toContainEqual(produced.slice(0, -1));
  });

  it('invalidates the trustline check, whose pre-activation entry is a cached Horizon 404', () => {
    // Clear cached pre-activation 404s for every token and amount.
    expect(invalidatedKeyPrefixes()).toContainEqual(['shared', 'stellarTrustlineCheck']);
  });

  it('invalidates Stellar balances through the shared invalidateBalances helper', () => {
    // Routed through invalidateBalances (covers both useBalances and useXBalances) rather than a
    // hand-rolled invalidateQueries call, so it is not one of the literal matches above.
    expect(SRC).toMatch(/invalidateBalances\(queryClient,\s*ChainKeys\.STELLAR_MAINNET\)/);
  });

  it('passes the whole mutation vars through to the SDK', () => {
    // Forwarding wholesale preserves retry and signature callback options.
    expect(SRC).toMatch(/activateStellarAccount\(vars\)/);
  });
});
