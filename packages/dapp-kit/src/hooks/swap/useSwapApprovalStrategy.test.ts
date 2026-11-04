import { ChainKeys } from '@sodax/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type CapturedQuery = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
  enabled: boolean;
  refetchInterval?: unknown;
};
let captured: CapturedQuery;
const getApprovalStrategy = vi.fn();

vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { swaps: { getApprovalStrategy } } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: CapturedQuery) => {
    captured = options;
    return {};
  },
}));

const { useSwapApprovalStrategy } = await import('./useSwapApprovalStrategy.js');

const PAYLOAD = {
  inputToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  outputToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  inputAmount: 1_000_000n,
  minOutputAmount: 900_000n,
  deadline: 0n,
  allowPartialFill: false,
  srcChainKey: ChainKeys.BSC_MAINNET,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  srcAddress: '0x1111111111111111111111111111111111111111',
  dstAddress: '0x2222222222222222222222222222222222222222',
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
} as const;
const WALLET = { chainType: 'EVM' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSwapApprovalStrategy', () => {
  it('keys on chain, owner, token and stringified amount', () => {
    useSwapApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: WALLET } });
    expect(captured.queryKey).toEqual([
      'swap',
      'approvalStrategy',
      ChainKeys.BSC_MAINNET,
      PAYLOAD.srcAddress,
      PAYLOAD.inputToken,
      '1000000',
      true,
    ]);
    expect(captured.enabled).toBe(true);
    expect(captured.refetchInterval).toBeUndefined();
  });

  it('unwraps the SDK strategy', async () => {
    getApprovalStrategy.mockResolvedValueOnce({ ok: true, value: 'atomic-batch' });
    useSwapApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: WALLET } });

    await expect(captured.queryFn()).resolves.toBe('atomic-batch');
    expect(getApprovalStrategy).toHaveBeenCalledWith({
      params: PAYLOAD,
      walletProvider: WALLET,
      allowAccountUpgrade: true,
    });
  });

  it('keys on and forwards allowAccountUpgrade: false', async () => {
    getApprovalStrategy.mockResolvedValueOnce({ ok: true, value: 'sequential' });
    useSwapApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: WALLET, allowAccountUpgrade: false } });

    expect(captured.queryKey.at(-1)).toBe(false);
    await expect(captured.queryFn()).resolves.toBe('sequential');
    expect(getApprovalStrategy).toHaveBeenCalledWith({
      params: PAYLOAD,
      walletProvider: WALLET,
      allowAccountUpgrade: false,
    });
  });

  it('stays disabled until both the payload and the wallet are known', () => {
    useSwapApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: undefined } });
    expect(captured.enabled).toBe(false);
    useSwapApprovalStrategy({ params: { payload: undefined, walletProvider: WALLET } });
    expect(captured.enabled).toBe(false);
  });
});
