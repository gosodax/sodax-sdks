import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const destinationCheck = vi.fn();
const establish = vi.fn();
const requiresAssociation = vi.fn(() => true);

// Stubbing the child hooks keeps this a DOM-free assertion on the params the gate builds;
// the resolver itself is covered by utils/hederaGate.test.ts.
vi.mock('./useHederaDestinationCheck.js', () => ({
  useHederaDestinationCheck: (args: unknown) => destinationCheck(args),
}));
vi.mock('./useEstablishHederaAssociation.js', () => ({
  useEstablishHederaAssociation: () => ({ mutateAsyncSafe: establish, isPending: false }),
}));
vi.mock('./useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { spoke: { hedera: { requiresAssociation } } } }),
}));

const { useHederaGate } = await import('./useHederaGate.js');

const TOKEN = '0x000000000000000000000000000000000006f89a';
const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const EVM_WALLET = { chainType: 'EVM' };

const refetch = vi.fn();
const idle = { isLoading: false, isError: false, data: undefined, error: null, refetch };

const run = (readiness: unknown, overrides: Record<string, unknown> = {}) => {
  destinationCheck.mockReturnValue({ ...idle, data: readiness });
  const gate = useHederaGate({
    dstChainKey: ChainKeys.HEDERA_MAINNET,
    token: TOKEN,
    address: ADDRESS,
    walletProvider: EVM_WALLET,
    ...overrides,
  } as never);
  return { gate, destinationParams: destinationCheck.mock.calls[0]?.[0]?.params };
};

beforeEach(() => {
  destinationCheck.mockReset();
  establish.mockReset();
  refetch.mockReset();
  requiresAssociation.mockReset().mockReturnValue(true);
});

describe('useHederaGate', () => {
  it('checks the destination for exactly the swap output token', () => {
    const { destinationParams } = run({ ready: true });

    expect(destinationParams).toEqual({ chainId: ChainKeys.HEDERA_MAINNET, token: TOKEN, address: ADDRESS });
    expect(requiresAssociation).toHaveBeenCalledWith(TOKEN);
  });

  it('reads nothing for HBAR or another chain', () => {
    requiresAssociation.mockReturnValue(false);
    expect(run(undefined).destinationParams?.chainId).toBeUndefined();

    requiresAssociation.mockReturnValue(true);
    destinationCheck.mockReset();
    expect(run(undefined, { dstChainKey: ChainKeys.XRP_MAINNET }).destinationParams?.chainId).toBeUndefined();
  });

  it('needs the association for an unassociated account', () => {
    const { gate } = run({ ready: false, reason: 'not_associated' });

    expect(gate.needsAssociation).toBe(true);
    expect(gate.blockedReason).toBeUndefined();
    expect(gate.blocksAction).toBe(true);
  });

  it('associates the token with the EVM destination wallet only', async () => {
    establish.mockResolvedValue({ ok: true, value: '0xhash' });
    const { gate } = run({ ready: false, reason: 'not_associated' });

    await expect(gate.requestAssociation()).resolves.toEqual({ ok: true, value: '0xhash' });
    // The checked recipient travels with the request, so the mutation can refuse another connected account.
    expect(establish).toHaveBeenCalledWith({ token: TOKEN, address: ADDRESS, walletProvider: EVM_WALLET });

    establish.mockReset();
    const { gate: xrpWallet } = run(
      { ready: false, reason: 'not_associated' },
      { walletProvider: { chainType: 'XRP' } },
    );
    await expect(xrpWallet.requestAssociation()).resolves.toBeUndefined();
    expect(establish).not.toHaveBeenCalled();
  });

  it('does nothing without a token or an address', async () => {
    const { gate } = run({ ready: false, reason: 'not_associated' }, { address: undefined });

    await expect(gate.requestAssociation()).resolves.toBeUndefined();
    expect(establish).not.toHaveBeenCalled();
  });

  it('surfaces a refusal no association fixes as blockedReason', () => {
    const { gate } = run({ ready: false, reason: 'kyc_not_granted' });

    expect(gate.blockedReason).toBe('kyc_not_granted');
    expect(gate.needsAssociation).toBe(false);
    expect(gate.blocksAction).toBe(true);
  });

  it('re-reads the check on retry, and surfaces its error', () => {
    const error = new Error('hedera mirror node: HTTP 503');
    destinationCheck.mockReturnValue({ ...idle, isError: true, error });
    const gate = useHederaGate({
      dstChainKey: ChainKeys.HEDERA_MAINNET,
      token: TOKEN,
      address: ADDRESS,
      walletProvider: EVM_WALLET,
    } as never);

    expect(gate.checkFailed).toBe(true);
    expect(gate.error).toBe(error);
    gate.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
