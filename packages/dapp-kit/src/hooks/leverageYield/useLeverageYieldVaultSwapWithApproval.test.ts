import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const VARS = {
  params: { srcChainKey: ChainKeys.ARBITRUM_MAINNET, dstChainKey: ChainKeys.SONIC_MAINNET },
  walletProvider: {},
};

type CapturedMutation = {
  mutationKey: unknown;
  mutationFn: (vars: unknown) => Promise<unknown>;
  onSuccess: (data: unknown, vars: typeof VARS, ctx: unknown) => Promise<void>;
};
let captured: CapturedMutation;
const invalidateQueries = vi.fn();
const vaultSwapWithApproval = vi.fn();

vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { leverageYield: { vaultSwapWithApproval } } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../shared/useSafeMutation.js', () => ({
  useSafeMutation: (options: CapturedMutation) => {
    captured = options;
    return {};
  },
}));

const { useLeverageYieldVaultSwapWithApproval } = await import('./useLeverageYieldVaultSwapWithApproval.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLeverageYieldVaultSwapWithApproval', () => {
  it('keys the mutation under leverageYield and calls vaultSwapWithApproval in signed mode', async () => {
    vaultSwapWithApproval.mockResolvedValueOnce({ ok: true, value: { approvalStrategy: 'atomic-batch' } });
    useLeverageYieldVaultSwapWithApproval();

    expect(captured.mutationKey).toEqual(['leverageYield', 'vaultSwapWithApproval']);
    await expect(captured.mutationFn(VARS)).resolves.toEqual({ approvalStrategy: 'atomic-batch' });
    expect(vaultSwapWithApproval).toHaveBeenCalledWith({ ...VARS, raw: false });
  });

  it('passes a batch resume through to the SDK', async () => {
    vaultSwapWithApproval.mockResolvedValueOnce({ ok: true, value: { approvalStrategy: 'atomic-batch' } });
    useLeverageYieldVaultSwapWithApproval();
    const resume = { ...VARS, resumeBatchId: 'batch-1', resumeBatchCallCount: 2 };

    await captured.mutationFn(resume);

    expect(vaultSwapWithApproval).toHaveBeenCalledWith({ ...resume, raw: false });
  });

  it('throws the SDK error so React Query sees a failure', async () => {
    const error = new Error('USER_REJECTED');
    vaultSwapWithApproval.mockResolvedValueOnce({ ok: false, error });
    useLeverageYieldVaultSwapWithApproval();

    await expect(captured.mutationFn(VARS)).rejects.toBe(error);
  });

  it('invalidates the deposit allowance and approval strategy on success, then runs the consumer callback', async () => {
    const onSuccess = vi.fn();
    useLeverageYieldVaultSwapWithApproval({ mutationOptions: { onSuccess } });

    await captured.onSuccess({}, VARS, undefined);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['swap', 'allowance'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['leverageYield', 'approvalStrategy'] });
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
