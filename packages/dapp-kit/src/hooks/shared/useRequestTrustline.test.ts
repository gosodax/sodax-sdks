import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MutationState = {
  mutateAsync: (vars: unknown) => Promise<string>;
  isPending: boolean;
  isSuccess: boolean;
  error: Error | null;
  data: string | undefined;
};

let mutation: MutationState;

const refSlots: Array<{ current: unknown }> = [];
let refCursor = 0;

// Replays React's ref slots by call order, enough to observe the hook across renders without a DOM.
vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const slot = refSlots[refCursor] ?? { current: initial };
    refSlots[refCursor] = slot;
    refCursor += 1;
    return slot;
  },
  useCallback: (fn: unknown) => fn,
}));
vi.mock('./useEstablishTrustline.js', () => ({ useEstablishTrustline: () => mutation }));

const { useRequestTrustline } = await import('./useRequestTrustline.js');

const TOKEN = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const idle: MutationState = {
  mutateAsync: async () => 'hash',
  isPending: false,
  isSuccess: false,
  error: null,
  data: undefined,
};

const render = (state: Partial<MutationState> = {}) => {
  mutation = { ...idle, ...state };
  refCursor = 0;
  return useRequestTrustline(TOKEN);
};

beforeEach(() => {
  refSlots.length = 0;
  refCursor = 0;
});

describe('useRequestTrustline — 2.0.0 compatibility wrapper', () => {
  it('exposes the released shape', () => {
    const result = render();

    expect(Object.keys(result).sort()).toEqual(['data', 'error', 'isLoading', 'isRequested', 'requestTrustline']);
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
    expect(result.isLoading).toBe(false);
    expect(result.isRequested).toBe(false);
  });

  it('maps isLoading to the mutation pending state', () => {
    expect(render({ isPending: true }).isLoading).toBe(true);
  });

  it('surfaces the mutation error', () => {
    const error = new Error('trustline failed');

    expect(render({ error }).error).toBe(error);
  });

  it('LATCHES isRequested and data, so a failed retry cannot un-report a live trustline', () => {
    const first = render({ isSuccess: true, data: 'hash' });
    expect(first.isRequested).toBe(true);
    expect(first.data).toBe('hash');

    const retrying = render({ isPending: true });
    expect(retrying.isRequested).toBe(true);
    expect(retrying.data).toBe('hash');

    const failed = render({ error: new Error('nope') });
    expect(failed.isRequested).toBe(true);
    expect(failed.data).toBe('hash');
  });

  it('forwards vars to the canonical mutation and resolves to the hash', async () => {
    const mutateAsync = vi.fn(async () => 'hash');
    const vars = {
      token: TOKEN,
      amount: 1_000_000n,
      srcChainKey: ChainKeys.STELLAR_MAINNET,
      walletProvider: { getWalletAddress: async () => 'G…' } as never,
    };

    await expect(render({ mutateAsync }).requestTrustline(vars)).resolves.toBe('hash');
    expect(mutateAsync).toHaveBeenCalledWith(vars);
  });

  it('rejects with an Error even when the mutation throws a non-Error', async () => {
    const rejecting = render({
      mutateAsync: async () => {
        throw 'string failure';
      },
    });

    await expect(rejecting.requestTrustline({} as never)).rejects.toThrow('Unknown error occurred');
  });
});
