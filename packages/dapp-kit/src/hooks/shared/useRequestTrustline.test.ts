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

// Only useRef and useCallback are needed, and call order is stable, so this replays React's
// slot semantics well enough to observe the deprecated hook across renders — no DOM, no renderer.
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

/** One render of the hook, with the mutation in `state`. */
const render = (state: Partial<MutationState> = {}) => {
  mutation = { ...idle, ...state };
  refCursor = 0;
  // The positional argument was ignored in 2.0.0 and still is; passed here because keeping it
  // callable is the point of this wrapper.
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

  it('maps pending/error, and LATCHES isRequested and data so a failed retry keeps the live trustline', () => {
    const first = render({ isSuccess: true, data: 'hash' });
    expect(first.isRequested).toBe(true);
    expect(first.data).toBe('hash');

    // React Query clears data and isSuccess once the next attempt starts; 2.0.0 held both
    // in component state and never cleared them.
    const retrying = render({ isPending: true });
    expect(retrying.isLoading).toBe(true);
    expect(retrying.isRequested).toBe(true);
    expect(retrying.data).toBe('hash');

    const error = new Error('nope');
    const failed = render({ error });
    expect(failed.error).toBe(error);
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
