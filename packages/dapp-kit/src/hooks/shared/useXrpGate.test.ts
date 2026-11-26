import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const destinationCheck = vi.fn();
const reserveCheck = vi.fn();
const establish = vi.fn();
const requiresTrustline = vi.fn(() => true);

// Stubbing the child hooks keeps this a DOM-free assertion on the params the gate builds;
// the resolver itself is covered by utils/xrpGate.test.ts.
vi.mock('./useXrpDestinationCheck.js', () => ({
  useXrpDestinationCheck: (args: unknown) => destinationCheck(args),
}));
vi.mock('./useXrpTrustlineReserveCheck.js', () => ({
  useXrpTrustlineReserveCheck: (args: unknown) => reserveCheck(args),
}));
vi.mock('./useEstablishXrpTrustline.js', () => ({
  useEstablishXrpTrustline: () => ({ mutateAsyncSafe: establish, isPending: false }),
}));
vi.mock('./useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { spoke: { xrp: { requiresTrustline } } } }),
}));

const { useXrpGate } = await import('./useXrpGate.js');

const TOKEN = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const ADDRESS = 'rJB8dmrf4JxkLKHPUfdxyPwpXMyxjkQsyG';
const XRP_WALLET = { chainType: 'XRP' };

const idle = { isLoading: false, isError: false, data: undefined, error: null, refetch: vi.fn() };

const run = (readiness: unknown, overrides: Record<string, unknown> = {}) => {
  destinationCheck.mockReturnValue({ ...idle, data: readiness });
  reserveCheck.mockReturnValue({ ...idle, data: true });
  const gate = useXrpGate({
    dstChainKey: ChainKeys.XRP_MAINNET,
    token: TOKEN,
    address: ADDRESS,
    amount: 1_000_000n,
    maxAmount: 2_000_000n,
    walletProvider: XRP_WALLET,
    ...overrides,
  } as never);
  return {
    gate,
    destinationParams: destinationCheck.mock.calls[0]?.[0]?.params,
    reserveParams: reserveCheck.mock.calls[0]?.[0]?.params,
  };
};

beforeEach(() => {
  destinationCheck.mockReset();
  reserveCheck.mockReset();
  establish.mockReset();
  requiresTrustline.mockReset().mockReturnValue(true);
});

describe('useXrpGate', () => {
  it('checks the destination with the amount and the most that can arrive', () => {
    const { destinationParams } = run({ ready: true });

    expect(destinationParams).toEqual({
      chainId: ChainKeys.XRP_MAINNET,
      token: TOKEN,
      address: ADDRESS,
      amount: 1_000_000n,
      maxAmount: 2_000_000n,
    });
  });

  it('reads nothing for native XRP or another chain', () => {
    requiresTrustline.mockReturnValue(false);
    expect(run(undefined).destinationParams?.chainId).toBeUndefined();

    requiresTrustline.mockReturnValue(true);
    destinationCheck.mockReset();
    expect(run(undefined, { dstChainKey: ChainKeys.STELLAR_MAINNET }).destinationParams?.chainId).toBeUndefined();
  });

  it('reads the reserve only once the trustline is known to need setting', () => {
    expect(run({ ready: true }).reserveParams).toEqual({ token: undefined, address: undefined });

    reserveCheck.mockReset();
    destinationCheck.mockReset();
    expect(run({ ready: false, reason: 'issuer_frozen' }).reserveParams).toEqual({
      token: undefined,
      address: undefined,
    });

    reserveCheck.mockReset();
    destinationCheck.mockReset();
    const { gate, reserveParams } = run({ ready: false, reason: 'no_trustline' });
    expect(reserveParams).toEqual({ token: TOKEN, address: ADDRESS });
    expect(gate.needsTrustline).toBe(true);
  });

  it('requests the trustline with the XRPL destination wallet only', async () => {
    establish.mockResolvedValue({ ok: true, value: 'hash' });
    const { gate } = run({ ready: false, reason: 'trustline_limit' });

    await expect(gate.requestTrustline()).resolves.toEqual({ ok: true, value: 'hash' });
    // The checked recipient travels with the request, so the mutation can refuse another connected account.
    expect(establish).toHaveBeenCalledWith({ token: TOKEN, address: ADDRESS, walletProvider: XRP_WALLET });

    establish.mockReset();
    const { gate: evmWallet } = run({ ready: false, reason: 'no_trustline' }, { walletProvider: { chainType: 'EVM' } });
    await expect(evmWallet.requestTrustline()).resolves.toBeUndefined();
    expect(establish).not.toHaveBeenCalled();
  });

  it('surfaces a refusal no trustline fixes as blockedReason', () => {
    const { gate } = run({ ready: false, reason: 'trustline_unauthorized' });

    expect(gate.blockedReason).toBe('trustline_unauthorized');
    expect(gate.needsTrustline).toBe(false);
    expect(gate.blocksAction).toBe(true);
  });
});
