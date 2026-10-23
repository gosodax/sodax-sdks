import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const VARS = {
  params: { srcChainKey: ChainKeys.BSC_MAINNET, dstChainKey: ChainKeys.ARBITRUM_MAINNET },
  walletProvider: {},
};

type CapturedMutation = {
  mutationKey: unknown;
  mutationFn: (vars: unknown) => Promise<unknown>;
  onSuccess: (data: unknown, vars: typeof VARS, ctx: unknown) => Promise<void>;
};
let captured: CapturedMutation;
const invalidateQueries = vi.fn();
const bridgeWithApproval = vi.fn();

vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { bridge: { bridgeWithApproval } } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../shared/useSafeMutation.js', () => ({
  useSafeMutation: (options: CapturedMutation) => {
    captured = options;
    return {};
  },
}));

const { useBridgeWithApproval } = await import('./useBridgeWithApproval.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBridgeWithApproval', () => {
  it('keys the mutation under bridge and calls bridgeWithApproval in signed mode', async () => {
    bridgeWithApproval.mockResolvedValueOnce({ ok: true, value: { approvalStrategy: 'atomic-batch' } });
    useBridgeWithApproval();

    expect(captured.mutationKey).toEqual(['bridge', 'bridgeWithApproval']);
    await expect(captured.mutationFn(VARS)).resolves.toEqual({ approvalStrategy: 'atomic-batch' });
    expect(bridgeWithApproval).toHaveBeenCalledWith({ ...VARS, raw: false });
  });

  it('passes a batch resume through to the SDK', async () => {
    bridgeWithApproval.mockResolvedValueOnce({ ok: true, value: { approvalStrategy: 'atomic-batch' } });
    useBridgeWithApproval();
    const resume = { ...VARS, resumeBatchId: 'batch-1', resumeBatchCallCount: 2 };

    await captured.mutationFn(resume);

    expect(bridgeWithApproval).toHaveBeenCalledWith({ ...resume, raw: false });
  });

  it('throws the SDK error so React Query sees a failure', async () => {
    const error = new Error('USER_REJECTED');
    bridgeWithApproval.mockResolvedValueOnce({ ok: false, error });
    useBridgeWithApproval();

    await expect(captured.mutationFn(VARS)).rejects.toBe(error);
  });

  it('invalidates allowance and approval strategy on success, then runs the consumer callback', async () => {
    const onSuccess = vi.fn();
    useBridgeWithApproval({ mutationOptions: { onSuccess } });

    await captured.onSuccess({}, VARS, undefined);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bridge', 'allowance'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bridge', 'approvalStrategy'] });
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
