import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const statusCheck = vi.fn();
const trustlineCheck = vi.fn();
const requiresTrustline = vi.fn(() => true);

// Stubbing the child hooks keeps this a DOM-free assertion on the params the gate builds —
// the resolver itself is covered by utils/stellarGate.test.ts.
vi.mock('../sponsoring/useStellarAccountStatus.js', () => ({
  useStellarAccountStatus: (args: unknown) => statusCheck(args),
}));
vi.mock('./useStellarTrustlineCheck.js', () => ({
  useStellarTrustlineCheck: (args: unknown) => trustlineCheck(args),
}));
vi.mock('../sponsoring/useActivateStellarAccount.js', () => ({
  useActivateStellarAccount: () => ({ mutateAsyncSafe: vi.fn(), isPending: false }),
}));
vi.mock('./useEstablishTrustline.js', () => ({
  useEstablishTrustline: () => ({ mutateAsyncSafe: vi.fn(), isPending: false }),
}));
vi.mock('./useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { spoke: { stellar: { requiresTrustline } } } }),
}));

const { useStellarGate } = await import('./useStellarGate.js');

const TOKEN = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const idle = { isLoading: false, isError: false, data: undefined, error: null, refetch: vi.fn() };

/**
 * Drive the gate with a given account-status result. An absent `walletAddress` is what
 * leaves `useStellarTrustlineCheck` disabled, so it stands in for "no Horizon read".
 */
const run = (status: unknown, overrides: Record<string, unknown> = {}) => {
  statusCheck.mockReturnValue({ ...idle, ...(status as object) });
  trustlineCheck.mockReturnValue(idle);

  const gate = useStellarGate({
    dstChainKey: ChainKeys.STELLAR_MAINNET,
    token: TOKEN,
    amount: 1_000_000n,
    address: ADDRESS,
    walletProvider: undefined,
    ...overrides,
  } as never);

  return { gate, trustlineAddress: trustlineCheck.mock.calls[0]?.[0]?.params?.walletAddress };
};

beforeEach(() => {
  statusCheck.mockReset();
  trustlineCheck.mockReset();
  requiresTrustline.mockReset().mockReturnValue(true);
});

describe('useStellarGate — the trustline read is gated on account existence', () => {
  it('does NOT read the trustline for an account that does not exist', () => {
    // hasSufficientTrustline 404s on a missing account, and React Query would retry it.
    const { gate, trustlineAddress } = run({ data: { exists: false, canAffordTrustline: false } });

    expect(trustlineAddress).toBeUndefined();
    // The gate still reaches the right conclusion without the trustline read.
    expect(gate.needsActivation).toBe(true);
    expect(gate.blocksAction).toBe(true);
    expect(gate.checkFailed).toBe(false);
    // No spurious error while the UI is showing "activate".
    expect(gate.error).toBeUndefined();
  });

  it('does NOT read the trustline while account status is still loading', () => {
    expect(run({ isLoading: true }).trustlineAddress).toBeUndefined();
  });

  it('does NOT read the trustline when the account-status read failed', () => {
    const { gate, trustlineAddress } = run({ isError: true, error: new Error('horizon down') });

    expect(trustlineAddress).toBeUndefined();
    expect(gate.checkFailed).toBe(true);
    expect(gate.blocksAction).toBe(true);
  });

  it('reads the trustline once the account is known to exist', () => {
    expect(run({ data: { exists: true, canAffordTrustline: true } }).trustlineAddress).toBe(ADDRESS);
  });

  it('does not read a Stellar trustline for a non-Stellar destination', () => {
    const { gate, trustlineAddress } = run(
      { data: { exists: true, canAffordTrustline: true } },
      { dstChainKey: ChainKeys.SONIC_MAINNET },
    );

    expect(trustlineAddress).toBeUndefined();
    expect(gate.isStellar).toBe(false);
    expect(gate.blocksAction).toBe(false);
  });
});
