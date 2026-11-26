import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidateQueries = vi.fn();
const requestTrustline = vi.fn();

// The hook is a pure options builder around useSafeMutation, so stubbing the React-side imports
// lets the real mutationFn and onSuccess run without a DOM.
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('./useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { spoke: { xrp: { requestTrustline } } } }),
}));
vi.mock('./useSafeMutation.js', () => ({ useSafeMutation: (options: unknown) => options }));

const { useEstablishXrpTrustline } = await import('./useEstablishXrpTrustline.js');

const TOKEN = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const ADDRESS = 'rJB8dmrf4JxkLKHPUfdxyPwpXMyxjkQsyG';

type OnSuccess = (data: string, vars: unknown, ctx: unknown) => Promise<void>;
type MutationFn = (vars: unknown) => Promise<string>;

const vars = (getWalletAddress: () => Promise<string>) => ({ token: TOKEN, walletProvider: { getWalletAddress } });

// The stubbed useSafeMutation returns its options, which the hook's declared return type does not describe.
const optionsOf = () => useEstablishXrpTrustline() as unknown as { onSuccess: OnSuccess; mutationFn: MutationFn };

const invalidatedKeys = () => invalidateQueries.mock.calls.map(([arg]) => arg.queryKey);

beforeEach(() => {
  invalidateQueries.mockReset();
  requestTrustline.mockReset();
});

describe('useEstablishXrpTrustline', () => {
  it('requests the trustline for the wallet account and returns the validated hash', async () => {
    requestTrustline.mockResolvedValue({ ok: true, value: 'hash' });
    const request = vars(async () => ADDRESS);

    await expect(optionsOf().mutationFn(request)).resolves.toBe('hash');
    expect(requestTrustline).toHaveBeenCalledWith({
      srcAddress: ADDRESS,
      token: TOKEN,
      walletProvider: request.walletProvider,
    });
  });

  it('refuses, before signing, a wallet connected to another account than the one that needs the line', async () => {
    const request = { ...vars(async () => ADDRESS), address: 'rOtherAccount1111111111111111111111' };

    await expect(optionsOf().mutationFn(request)).rejects.toThrow(/is not rOtherAccount/);
    expect(requestTrustline).not.toHaveBeenCalled();
  });

  it('proceeds when the wallet controls the account that needs the line', async () => {
    requestTrustline.mockResolvedValue({ ok: true, value: 'hash' });

    await expect(optionsOf().mutationFn({ ...vars(async () => ADDRESS), address: ADDRESS })).resolves.toBe('hash');
  });

  it('rejects with the SDK error, so mutateAsyncSafe reports it', async () => {
    const error = new Error('GemWallet transaction was rejected by the user');
    requestTrustline.mockResolvedValue({ ok: false, error });

    await expect(optionsOf().mutationFn(vars(async () => ADDRESS))).rejects.toBe(error);
  });

  it('invalidates the destination check for this account, the reserve check, and XRPL balances', async () => {
    await optionsOf().onSuccess(
      'hash',
      vars(async () => ADDRESS),
      undefined,
    );

    expect(invalidatedKeys()).toEqual([
      ['shared', 'xrpDestinationCheck', ChainKeys.XRP_MAINNET, TOKEN, ADDRESS],
      ['shared', 'xrpTrustlineReserveCheck'],
      ['shared', 'balances', ChainKeys.XRP_MAINNET],
      ['shared', 'xBalances', ChainKeys.XRP_MAINNET],
    ]);
  });

  it('still invalidates when the wallet fails right after the TrustSet validated', async () => {
    const locked = vars(async () => {
      throw new Error('wallet is locked');
    });

    await expect(optionsOf().onSuccess('hash', locked, undefined)).resolves.toBeUndefined();
    expect(invalidatedKeys()[0]).toEqual(['shared', 'xrpDestinationCheck']);
  });
});
