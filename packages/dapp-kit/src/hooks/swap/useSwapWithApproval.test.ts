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
const swapWithApproval = vi.fn();

vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { swaps: { swapWithApproval } } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../shared/useSafeMutation.js', () => ({
  useSafeMutation: (options: CapturedMutation) => {
    captured = options;
    return {};
  },
}));

const { useSwapWithApproval } = await import('./useSwapWithApproval.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSwapWithApproval', () => {
  it('keys the mutation under swap and calls swapWithApproval in signed mode', async () => {
    swapWithApproval.mockResolvedValueOnce({ ok: true, value: { approvalStrategy: 'atomic-batch' } });
    useSwapWithApproval();

    expect(captured.mutationKey).toEqual(['swap', 'swapWithApproval']);
    await expect(captured.mutationFn(VARS)).resolves.toEqual({ approvalStrategy: 'atomic-batch' });
    expect(swapWithApproval).toHaveBeenCalledWith({ ...VARS, raw: false });
  });

  it('throws the SDK error so React Query sees a failure', async () => {
    const error = new Error('USER_REJECTED');
    swapWithApproval.mockResolvedValueOnce({ ok: false, error });
    useSwapWithApproval();

    await expect(captured.mutationFn(VARS)).rejects.toBe(error);
  });

  it('invalidates allowance and approval strategy on success, then runs the consumer callback', async () => {
    const onSuccess = vi.fn();
    useSwapWithApproval({ mutationOptions: { onSuccess } });

    await captured.onSuccess({}, VARS, undefined);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['swap', 'allowance'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['swap', 'approvalStrategy'] });
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
