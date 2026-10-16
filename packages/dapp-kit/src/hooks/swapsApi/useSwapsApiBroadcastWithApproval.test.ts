/**
 * The hook folds the swaps-API approval into the intent broadcast: one EIP-5792 batch when the
 * wallet can, the approval plan then the intent tx when it cannot. The SDK's batch policy runs for
 * real here; only the wallet and the API are faked.
 *
 * Follows the package convention of testing hooks without a renderer: the React Query wrapper is
 * mocked so `mutationFn` can be captured and driven directly.
 */

import {
  ACCOUNT_UPGRADE_DECLINED,
  ATOMIC_BATCH_REFUSED,
  ATOMIC_BATCH_UNCONFIRMED,
  ChainKeys,
  type EvmAtomicBatchSupport,
  type EvmBatchResult,
  type EvmRawTransaction,
} from '@sodax/sdk';
import { AtomicityNotSupportedError, AtomicReadyWalletRejectedUpgradeError, UserRejectedRequestError } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const approve = vi.fn();
const invalidateQueries = vi.fn();

let captured: any;

vi.mock('../shared/useSodaxContext.js', () => ({
  useSodaxContext: () => ({ sodax: { api: { swaps: { approve } } } }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries }) }));
vi.mock('../shared/useSafeMutation.js', () => ({
  useSafeMutation: (options: any) => {
    captured = options;
    return {};
  },
}));

const { useSwapsApiBroadcastWithApproval } = await import('./useSwapsApiBroadcastWithApproval.js');

const SRC = '0x00000000000000000000000000000000000000a1';
const RESET_TX: EvmRawTransaction = {
  from: SRC,
  to: '0x00000000000000000000000000000000000000b1',
  value: 0n,
  data: '0x01',
};
const APPROVE_TX: EvmRawTransaction = {
  from: SRC,
  to: '0x00000000000000000000000000000000000000b1',
  value: 0n,
  data: '0x02',
};
const INTENT_TX: EvmRawTransaction = {
  from: SRC,
  to: '0x00000000000000000000000000000000000000c1',
  value: 0n,
  data: '0x03',
};

const BASE_CHAIN_ID = 8453;
const SONIC_CHAIN_ID = 146;

const body = (srcChainKey: string = ChainKeys.BASE_MAINNET) => ({
  srcChainKey,
  dstChainKey: ChainKeys.ARBITRUM_MAINNET,
  inputToken: '0x00000000000000000000000000000000000000d1',
  outputToken: '0x00000000000000000000000000000000000000d2',
  inputAmount: '1000000',
  minOutputAmount: '1',
  deadline: '0',
  allowPartialFill: false,
  srcAddress: SRC,
  dstAddress: SRC,
  solver: '0x0000000000000000000000000000000000000000',
  data: '0x',
});

const confirmed: EvmBatchResult = {
  status: 'success',
  statusCode: 200,
  atomic: true,
  receipts: [{ transactionHash: '0xdeposit', status: 'success' }],
};

/** Records sends and waits in order, so the sequential path's ordering is asserted, not assumed. */
function plainWallet(calls: string[]) {
  return {
    chainType: 'EVM' as const,
    getWalletAddress: vi.fn(async () => SRC.toUpperCase().replace('0X', '0x')),
    sendTransaction: vi.fn(async (tx: EvmRawTransaction, _options?: { expectedChainId?: number }) => {
      calls.push(`send:${tx.data}`);
      return `0xhash${tx.data.slice(2)}` as const;
    }),
    waitForTransactionReceipt: vi.fn(async (hash: string) => {
      calls.push(`wait:${hash}`);
      return { status: 'success' };
    }),
  };
}

function batchWallet(calls: string[], support: EvmAtomicBatchSupport) {
  return {
    ...plainWallet(calls),
    getAtomicBatchSupport: vi.fn(async (_chainId: number) => support),
    sendAtomicBatch: vi.fn(async (txs: readonly EvmRawTransaction[], _options: { expectedChainId: number }) => {
      calls.push(`batch:${txs.map(tx => tx.data).join(',')}`);
      return 'batch-1';
    }),
    waitForBatch: vi.fn(async (_batchId: string, _options?: { timeout?: number }) => confirmed),
  };
}

const run = (vars: any) => {
  useSwapsApiBroadcastWithApproval();
  return captured.mutationFn({ body: body(), intentTx: INTENT_TX, ...vars });
};

beforeEach(() => {
  vi.clearAllMocks();
  approve.mockResolvedValue({ ok: true, value: { tx: APPROVE_TX } });
});

describe('useSwapsApiBroadcastWithApproval', () => {
  it('sends approve + intent as one batch on a batch-capable wallet', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'supported');

    const result = await run({ walletProvider });

    expect(result).toEqual({ txHash: '0xdeposit', approvalStrategy: 'atomic-batch' });
    expect(calls).toEqual(['batch:0x02,0x03']);
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledWith([APPROVE_TX, INTENT_TX], {
      expectedChainId: BASE_CHAIN_ID,
    });
  });

  it('puts the allowance reset first in the batch', async () => {
    approve.mockResolvedValueOnce({ ok: true, value: { tx: APPROVE_TX, resetTx: RESET_TX } });
    const calls: string[] = [];

    await run({ walletProvider: batchWallet(calls, 'ready') });

    expect(calls).toEqual(['batch:0x01,0x02,0x03']);
  });

  it('rejects a wallet that cannot batch by default, sending nothing', async () => {
    const calls: string[] = [];
    const walletProvider = plainWallet(calls);

    await expect(run({ walletProvider })).rejects.toMatchObject({
      code: 'INTENT_CREATION_FAILED',
      context: { reason: ATOMIC_BATCH_REFUSED, approvalStrategy: 'sequential' },
    });
    expect(calls).toEqual([]);
  });

  it('approves separately, then sends the intent, when the wallet cannot batch and fallbackOnRefusal is true', async () => {
    const calls: string[] = [];
    const walletProvider = plainWallet(calls);

    const result = await run({ walletProvider, fallbackOnRefusal: true });

    expect(result).toEqual({
      txHash: '0xhash03',
      approvalStrategy: 'sequential',
      approval: { approveTxHash: '0xhash02' },
    });
    expect(calls).toEqual(['send:0x02', 'wait:0xhash02', 'send:0x03']);
    expect(walletProvider.sendTransaction).toHaveBeenLastCalledWith(INTENT_TX, { expectedChainId: BASE_CHAIN_ID });
  });

  it('reports the batch id and call count once the wallet accepts the batch', async () => {
    const onBatchSent = vi.fn();
    await run({ walletProvider: batchWallet([], 'supported'), onBatchSent });
    expect(onBatchSent).toHaveBeenCalledWith('batch-1', 2);
  });

  it('rejects a refused batch instead of approving by default', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'supported');
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));

    await expect(run({ walletProvider })).rejects.toMatchObject({
      code: 'INTENT_CREATION_FAILED',
      context: { reason: ATOMIC_BATCH_REFUSED },
    });
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
  });

  // The caller chose the batch on an earlier capability read; a later read that fails must not approve
  // and send its pre-approval intent behind the caller's back.
  it('hands back a wallet that can no longer batch by default', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'supported');
    walletProvider.getAtomicBatchSupport.mockRejectedValueOnce(new Error('capabilities unavailable'));

    await expect(run({ walletProvider })).rejects.toMatchObject({
      code: 'INTENT_CREATION_FAILED',
      context: { reason: ATOMIC_BATCH_REFUSED, approvalStrategy: 'sequential' },
    });
    expect(calls).toEqual([]);
  });

  it('refreshes the allowance once the approval lands, even when the intent is then rejected', async () => {
    const calls: string[] = [];
    const walletProvider = plainWallet(calls);
    walletProvider.sendTransaction.mockImplementation(async (tx: EvmRawTransaction) => {
      calls.push(`send:${tx.data}`);
      if (tx.data === INTENT_TX.data) throw new Error('User rejected the request.');
      return `0xhash${tx.data.slice(2)}` as const;
    });

    await expect(run({ walletProvider, fallbackOnRefusal: true })).rejects.toThrow('User rejected');
    expect(calls).toEqual(['send:0x02', 'wait:0xhash02', 'send:0x03']);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['swapsApi', 'allowance'] });
  });

  it('falls back to approving separately when the wallet refuses the batch and fallbackOnRefusal is true', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'supported');
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));

    const result = await run({ walletProvider, fallbackOnRefusal: true });

    expect(result.approvalStrategy).toBe('sequential');
    expect(calls).toEqual(['send:0x02', 'wait:0xhash02', 'send:0x03']);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('keeps a ready wallet sequential when the account upgrade is not allowed', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'ready');

    const result = await run({ walletProvider, allowAccountUpgrade: false, fallbackOnRefusal: true });

    expect(result.approvalStrategy).toBe('sequential');
    expect(walletProvider.sendAtomicBatch).not.toHaveBeenCalled();
  });

  it.each([
    ['a rejected batch', new UserRejectedRequestError(new Error('User rejected')), undefined],
    ['a declined upgrade', new AtomicReadyWalletRejectedUpgradeError(new Error('declined')), ACCOUNT_UPGRADE_DECLINED],
  ])('reports %s as USER_REJECTED and sends nothing else', async (_label, cause, reason) => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'ready');
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(cause);

    const error = await run({ walletProvider }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'USER_REJECTED' });
    expect((error as { context?: { reason?: string } }).context?.reason).toBe(reason);
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
  });

  it('never resends a batch that was sent but not confirmed', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'supported');
    walletProvider.waitForBatch.mockRejectedValueOnce(new Error('timed out'));

    await expect(run({ walletProvider })).rejects.toMatchObject({
      code: 'TX_VERIFICATION_FAILED',
      context: { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1' },
    });
    expect(walletProvider.sendTransaction).not.toHaveBeenCalled();
  });

  it('hands back a Sonic hub source by default, without asking the wallet', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'supported');

    await expect(run({ body: body(ChainKeys.SONIC_MAINNET), walletProvider })).rejects.toMatchObject({
      context: { reason: ATOMIC_BATCH_REFUSED },
    });
    expect(walletProvider.getAtomicBatchSupport).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('keeps the Sonic hub sequential without asking the wallet', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'supported');

    const result = await run({ body: body(ChainKeys.SONIC_MAINNET), walletProvider, fallbackOnRefusal: true });

    expect(result.approvalStrategy).toBe('sequential');
    expect(walletProvider.getAtomicBatchSupport).not.toHaveBeenCalled();
    expect(walletProvider.sendTransaction).toHaveBeenLastCalledWith(INTENT_TX, { expectedChainId: SONIC_CHAIN_ID });
  });

  it('refuses before sending when the connected account is not the source address', async () => {
    const calls: string[] = [];
    const walletProvider = batchWallet(calls, 'supported');
    walletProvider.getWalletAddress.mockResolvedValueOnce('0x00000000000000000000000000000000000000ff');

    await expect(run({ walletProvider })).rejects.toThrow(/not the swap's source address/);
    expect(calls).toEqual([]);
  });

  it('refuses an intent tx built for another account', async () => {
    const calls: string[] = [];

    await expect(
      run({
        walletProvider: batchWallet(calls, 'supported'),
        intentTx: { ...INTENT_TX, from: '0x00000000000000000000000000000000000000ff' },
      }),
    ).rejects.toThrow(/not the swap's source address/);
    expect(calls).toEqual([]);
  });

  it('refuses a non-EVM source before calling the API', async () => {
    await expect(run({ body: body(ChainKeys.SOLANA_MAINNET), walletProvider: plainWallet([]) })).rejects.toThrow(
      /not an EVM chain/,
    );
    expect(approve).not.toHaveBeenCalled();
  });

  it('awaits the allowance invalidation, then the consumer onSuccess', async () => {
    const order: string[] = [];
    invalidateQueries.mockImplementationOnce(async () => {
      order.push('invalidate');
    });
    const onSuccess = vi.fn(() => {
      order.push('consumer');
    });
    useSwapsApiBroadcastWithApproval({ mutationOptions: { onSuccess } });

    await captured.onSuccess({ txHash: '0xdeposit', approvalStrategy: 'atomic-batch' }, {}, undefined);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['swapsApi', 'allowance'] });
    expect(order).toEqual(['invalidate', 'consumer']);
  });
});
