import { ATOMIC_BATCH_UNCONFIRMED, ChainKeys, SodaxError } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const VARS = {
  params: { srcChainKey: ChainKeys.BSC_MAINNET, dstChainKey: ChainKeys.ARBITRUM_MAINNET },
  walletProvider: {},
};

type CapturedMutation = {
  mutationKey: unknown;
  retry: (failureCount: number, error: Error) => boolean;
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
  it.each([
    { batchId: 'batch-1' },
    { reason: ATOMIC_BATCH_UNCONFIRMED },
  ])('suppresses configured retries after an unconfirmed batch ($context)', context => {
    useBridgeWithApproval({ mutationOptions: { retry: 3 } });
    const error = new SodaxError('TX_VERIFICATION_FAILED', 'Batch was sent but not confirmed', {
      feature: 'bridge',
      context,
    });
    expect(captured.retry(0, error)).toBe(false);
  });

  it('suppresses configured retries when the original source hash is known', () => {
    useBridgeWithApproval({ mutationOptions: { retry: 3 } });
    const error = new SodaxError('RELAY_TIMEOUT', 'Settlement pending', {
      feature: 'bridge',
      context: { srcTxHash: '0x1234' },
    });
    expect(captured.retry(0, error)).toBe(false);
    expect(captured.retry(0, new Error('Before submission'))).toBe(true);
  });

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
