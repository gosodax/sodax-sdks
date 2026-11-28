import { ChainKeys, IndeterminateOutcomeError } from '@sodax/sdk';
import { getAddress } from 'viem';
import { getHederaDestinationCheckQueryOptions } from './useHederaDestinationCheck.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invalidateQueries = vi.fn();
const requestAssociation = vi.fn();

// The hook is a pure options builder around useSafeMutation, so stubbing the React-side imports
// lets the real mutationFn and onSuccess run without a DOM.
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('./useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { spoke: { hedera: { requestAssociation } } } }),
}));
vi.mock('./useSafeMutation.js', () => ({ useSafeMutation: (options: unknown) => options }));

const { useEstablishHederaAssociation } = await import('./useEstablishHederaAssociation.js');
const { QueryClient } = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');

const TOKEN = '0x000000000000000000000000000000000006f89a';
const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const OTHER = '0x9999999999999999999999999999999999999999';
const HASH = `0x${'ab'.repeat(32)}`;

type OnSuccess = (data: string, vars: unknown, ctx: unknown) => Promise<void>;
type MutationFn = (vars: unknown) => Promise<string>;

const vars = (getWalletAddress: () => Promise<string>) => ({ token: TOKEN, walletProvider: { getWalletAddress } });

// The stubbed useSafeMutation returns its options, which the hook's declared return type does not describe.
const optionsOf = (retry?: number) =>
  useEstablishHederaAssociation({ mutationOptions: { retry } }) as unknown as {
    onSuccess: OnSuccess;
    mutationFn: MutationFn;
    retry: (failureCount: number, error: Error) => boolean;
  };

const invalidatedKeys = () => invalidateQueries.mock.calls.map(([arg]) => arg.queryKey);

beforeEach(() => {
  invalidateQueries.mockReset();
  requestAssociation.mockReset();
});

describe('useEstablishHederaAssociation', () => {
  it('associates exactly the token for the wallet account and returns the mined hash', async () => {
    requestAssociation.mockResolvedValue({ ok: true, value: HASH });
    const request = vars(async () => ADDRESS);

    await expect(optionsOf().mutationFn(request)).resolves.toBe(HASH);
    expect(requestAssociation).toHaveBeenCalledTimes(1);
    expect(requestAssociation).toHaveBeenCalledWith({
      srcAddress: ADDRESS,
      token: TOKEN,
      walletProvider: request.walletProvider,
    });
  });

  it('refuses, before signing, a wallet connected to another account than the one that needs it', async () => {
    const request = { ...vars(async () => ADDRESS), address: OTHER };

    await expect(optionsOf().mutationFn(request)).rejects.toThrow(new RegExp(`is not ${OTHER}`));
    expect(requestAssociation).not.toHaveBeenCalled();
  });

  it('matches the account case-insensitively, as EVM addresses are', async () => {
    requestAssociation.mockResolvedValue({ ok: true, value: HASH });

    await expect(
      optionsOf().mutationFn({ ...vars(async () => ADDRESS), address: ADDRESS.toUpperCase().replace('0X', '0x') }),
    ).resolves.toBe(HASH);
  });

  it('rejects with the SDK error, so mutateAsyncSafe reports it', async () => {
    const error = new Error('User rejected the request');
    requestAssociation.mockResolvedValue({ ok: false, error });

    await expect(optionsOf().mutationFn(vars(async () => ADDRESS))).rejects.toBe(error);
  });

  it('invalidates the destination check for this account and token, and Hedera balances', async () => {
    await optionsOf().onSuccess(
      HASH,
      vars(async () => ADDRESS),
      undefined,
    );

    expect(invalidatedKeys()).toEqual([
      ['shared', 'hederaDestinationCheck', ChainKeys.HEDERA_MAINNET, TOKEN, ADDRESS],
      ['shared', 'balances', ChainKeys.HEDERA_MAINNET],
      ['shared', 'xBalances', ChainKeys.HEDERA_MAINNET],
    ]);
  });

  it('invalidates the checked account even after the wallet switched to another one', async () => {
    await optionsOf().onSuccess(HASH, { ...vars(async () => OTHER), address: ADDRESS }, undefined);

    expect(invalidatedKeys()[0]).toEqual([
      'shared',
      'hederaDestinationCheck',
      ChainKeys.HEDERA_MAINNET,
      TOKEN,
      ADDRESS,
    ]);
  });

  it.each([
    [ADDRESS, getAddress(ADDRESS)],
    [getAddress(ADDRESS), ADDRESS],
  ])('invalidates a check stored for %s after association as %s', async (checkedAddress, associatedAddress) => {
    const checkDestination = vi.fn().mockResolvedValue({ ready: false, reason: 'not_associated' });
    const check = getHederaDestinationCheckQueryOptions({
      sodax: { spoke: { hedera: { checkDestination } } },
      chainId: ChainKeys.HEDERA_MAINNET,
      token: TOKEN,
      address: checkedAddress,
    });
    const queryClient = new QueryClient();
    invalidateQueries.mockImplementation(filters => queryClient.invalidateQueries(filters));
    requestAssociation.mockResolvedValue({ ok: true, value: HASH });
    const request = { ...vars(async () => associatedAddress), address: associatedAddress };
    const options = optionsOf();

    queryClient.setQueryData(check.queryKey, await check.queryFn());
    expect(queryClient.getQueryState(check.queryKey)?.isInvalidated).toBe(false);
    const hash = await options.mutationFn(request);
    await options.onSuccess(hash, request, undefined);

    expect(queryClient.getQueryState(check.queryKey)?.isInvalidated).toBe(true);
    expect(invalidatedKeys()[0]).toEqual(check.queryKey);
    queryClient.clear();
  });

  it('never retries an association that may have been sent, since each one costs a fee', () => {
    const { retry } = optionsOf(3);

    expect(retry(0, new IndeterminateOutcomeError('outcome unknown', { cause: undefined, txHash: HASH }))).toBe(false);
    expect(retry(0, new Error('node unreachable'))).toBe(true);
  });

  it('still invalidates when the wallet fails right after the association landed', async () => {
    const locked = vars(async () => {
      throw new Error('wallet is locked');
    });

    await expect(optionsOf().onSuccess(HASH, locked, undefined)).resolves.toBeUndefined();
    expect(invalidatedKeys()[0]).toEqual(['shared', 'hederaDestinationCheck']);
  });
});
