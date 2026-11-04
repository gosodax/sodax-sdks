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
  useSodaxContext: () => ({ sodax: { leverageYield: { getApprovalStrategy } } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: CapturedQuery) => {
    captured = options;
    return {};
  },
}));

const { useLeverageYieldApprovalStrategy } = await import('./useLeverageYieldApprovalStrategy.js');

const PAYLOAD = {
  params: {
    inputToken: '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe',
    outputToken: '0xD09de2f5070699A909c0FD32fb5A909d3886701D',
    inputAmount: 1_000_000n,
    minOutputAmount: 900_000n,
    deadline: 0n,
    allowPartialFill: false,
    srcChainKey: ChainKeys.ARBITRUM_MAINNET,
    dstChainKey: ChainKeys.SONIC_MAINNET,
    srcAddress: '0x1111111111111111111111111111111111111111',
    dstAddress: '0x2222222222222222222222222222222222222222',
    solver: '0x0000000000000000000000000000000000000000',
    data: '0x',
  },
} as const;
const WALLET = { chainType: 'EVM' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLeverageYieldApprovalStrategy', () => {
  it('keys on chain, owner, token, stringified amount and direction', () => {
    useLeverageYieldApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: WALLET } });
    expect(captured.queryKey).toEqual([
      'leverageYield',
      'approvalStrategy',
      ChainKeys.ARBITRUM_MAINNET,
      PAYLOAD.params.srcAddress,
      PAYLOAD.params.inputToken,
      '1000000',
      false,
      true,
    ]);
    expect(captured.enabled).toBe(true);
    expect(captured.refetchInterval).toBeUndefined();
  });

  it('spreads the payload into the SDK call and unwraps the strategy', async () => {
    getApprovalStrategy.mockResolvedValueOnce({ ok: true, value: 'atomic-batch' });
    useLeverageYieldApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: WALLET } });

    await expect(captured.queryFn()).resolves.toBe('atomic-batch');
    expect(getApprovalStrategy).toHaveBeenCalledWith({
      ...PAYLOAD,
      walletProvider: WALLET,
      allowAccountUpgrade: true,
    });
  });

  it('stays disabled until both the payload and the wallet are known', () => {
    useLeverageYieldApprovalStrategy({ params: { payload: PAYLOAD, walletProvider: undefined } });
    expect(captured.enabled).toBe(false);
    useLeverageYieldApprovalStrategy({ params: { payload: undefined, walletProvider: WALLET } });
    expect(captured.enabled).toBe(false);
  });
});
