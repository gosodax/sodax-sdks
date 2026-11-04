import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidateQueries = vi.fn();
const requestTrustline = vi.fn();

// The hook is a pure options builder around useSafeMutation, so stubbing the three
// React-side imports lets the real onSuccess run without a DOM.
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('./useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { spoke: { stellar: { requestTrustline } } } }),
}));
vi.mock('./useSafeMutation.js', () => ({ useSafeMutation: (options: unknown) => options }));

const { useEstablishTrustline } = await import('./useEstablishTrustline.js');

const TOKEN = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

type OnSuccess = (data: string, vars: unknown, ctx: unknown) => Promise<void>;
type MutationFn = (vars: unknown) => Promise<string>;

const vars = (getWalletAddress: () => Promise<string>) => ({
  token: TOKEN,
  amount: 1_000_000n,
  srcChainKey: ChainKeys.STELLAR_MAINNET,
  walletProvider: { getWalletAddress } as never,
});

const optionsOf = () => useEstablishTrustline() as unknown as { onSuccess: OnSuccess; mutationFn: MutationFn };

const invalidatedKeys = () => invalidateQueries.mock.calls.map(([arg]) => arg.queryKey);

beforeEach(() => {
  invalidateQueries.mockReset();
  requestTrustline.mockReset();
});

describe('useEstablishTrustline — invalidation after a broadcast trustline', () => {
  it('invalidates the account-scoped keys when the address is readable', async () => {
    await optionsOf().onSuccess(
      'hash',
      vars(async () => ADDRESS),
      undefined,
    );

    expect(invalidatedKeys()).toEqual([
      ['shared', 'stellarTrustlineCheck', ChainKeys.STELLAR_MAINNET, TOKEN, ADDRESS],
      ['sponsoring', 'stellarAccountStatus', ADDRESS],
      ['shared', 'balances', ChainKeys.STELLAR_MAINNET],
      ['shared', 'xBalances', ChainKeys.STELLAR_MAINNET],
    ]);
  });

  it('SURVIVES a wallet that fails right after signing, and still invalidates', async () => {
    // The trustline is already on-chain here: throwing would report success as an
    // error and leave the gate showing "needs a trustline" until a manual refetch.
    const rejecting = vars(async () => {
      throw new Error('wallet is locked');
    });

    await expect(optionsOf().onSuccess('hash', rejecting, undefined)).resolves.toBeUndefined();

    // Falls back to the whole prefix, because the account is no longer identifiable.
    expect(invalidatedKeys()).toEqual([
      ['shared', 'stellarTrustlineCheck'],
      ['sponsoring', 'stellarAccountStatus'],
      ['shared', 'balances', ChainKeys.STELLAR_MAINNET],
      ['shared', 'xBalances', ChainKeys.STELLAR_MAINNET],
    ]);
  });
});

describe('useEstablishTrustline — input guard carried over from useRequestTrustline', () => {
  it.each([
    ['a zero amount', { amount: 0n }],
    ['an empty token', { token: '' }],
  ])('rejects %s without reaching the wallet', async (_label, override) => {
    const invalid = { ...vars(async () => ADDRESS), ...override };

    await expect(optionsOf().mutationFn(invalid)).rejects.toThrow('Token and amount are required');
    expect(requestTrustline).not.toHaveBeenCalled();
  });

  it('derives srcAddress from the wallet provider for a valid request', async () => {
    requestTrustline.mockResolvedValue('hash');

    await expect(optionsOf().mutationFn(vars(async () => ADDRESS))).resolves.toBe('hash');
    expect(requestTrustline).toHaveBeenCalledWith(expect.objectContaining({ raw: false, srcAddress: ADDRESS }));
  });
});
