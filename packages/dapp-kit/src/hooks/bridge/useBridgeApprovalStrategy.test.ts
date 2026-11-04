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
  useSodaxContext: () => ({ sodax: { bridge: { getApprovalStrategy } } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: CapturedQuery) => {
    captured = options;
    return {};
  },
}));

const { useBridgeApprovalStrategy } = await import('./useBridgeApprovalStrategy.js');

const PAYLOAD = {
  srcAddress: '0x1111111111111111111111111111111111111111',
  srcChainKey: ChainKeys.BSC_MAINNET,
  srcToken: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  amount: 1_000_000n,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  dstToken: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  recipient: '0x2222222222222222222222222222222222222222',
} as const;
const WALLET = { chainType: 'EVM' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBridgeApprovalStrategy', () => {
  it('keys on chain, owner, token and stringified amount', () => {
    useBridgeApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: WALLET } });
    expect(captured.queryKey).toEqual([
      'bridge',
      'approvalStrategy',
      ChainKeys.BSC_MAINNET,
      PAYLOAD.srcAddress,
      PAYLOAD.srcToken,
      '1000000',
      true,
    ]);
    expect(captured.enabled).toBe(true);
    expect(captured.refetchInterval).toBeUndefined();
  });

  it('unwraps the SDK strategy and forwards allowAccountUpgrade', async () => {
    getApprovalStrategy.mockResolvedValueOnce({ ok: true, value: 'sequential' });
    useBridgeApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: WALLET, allowAccountUpgrade: false } });

    expect(captured.queryKey.at(-1)).toBe(false);
    await expect(captured.queryFn()).resolves.toBe('sequential');
    expect(getApprovalStrategy).toHaveBeenCalledWith({
      params: PAYLOAD,
      walletProvider: WALLET,
      allowAccountUpgrade: false,
    });
  });

  it('stays disabled until both the payload and the wallet are known', () => {
    useBridgeApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: undefined } });
    expect(captured.enabled).toBe(false);
    useBridgeApprovalStrategy({ params: { payload: undefined, walletProvider: WALLET } });
    expect(captured.enabled).toBe(false);
  });
});
