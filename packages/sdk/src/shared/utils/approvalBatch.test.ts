import { describe, expect, it, vi } from 'vitest';
import {
  ChainKeys,
  type EvmAtomicBatchSupport,
  type EvmBatchResult,
  type EvmRawTransaction,
  type IEvmWalletProvider,
} from '@sodax/types';
import { AtomicityNotSupportedError, AtomicReadyWalletRejectedUpgradeError, UserRejectedRequestError } from 'viem';
import {
  ACCOUNT_UPGRADE_DECLINED,
  ATOMIC_BATCH_REFUSED,
  ATOMIC_BATCH_UNCONFIRMED,
  resolveApprovalStrategy,
  sendApprovalBatch,
} from './approvalBatch.js';

const BASE_CHAIN_ID = 8453;

const APPROVE_TX: EvmRawTransaction = {
  from: '0x0000000000000000000000000000000000000001',
  to: '0x00000000000000000000000000000000000000aa',
  value: 0n,
  data: '0x095ea7b3',
};
const DEPOSIT_TX: EvmRawTransaction = {
  from: '0x0000000000000000000000000000000000000001',
  to: '0x00000000000000000000000000000000000000bb',
  value: 0n,
  data: '0xdeadbeef',
};

const confirmed: EvmBatchResult = {
  status: 'success',
  statusCode: 200,
  atomic: true,
  receipts: [{ transactionHash: '0xdeposit', status: 'success' }],
};

const plainProvider = (): IEvmWalletProvider => ({
  chainType: 'EVM',
  getWalletAddress: vi.fn<IEvmWalletProvider['getWalletAddress']>(),
  sendTransaction: vi.fn<IEvmWalletProvider['sendTransaction']>(),
  waitForTransactionReceipt: vi.fn<IEvmWalletProvider['waitForTransactionReceipt']>(),
});

const batchProvider = (support: EvmAtomicBatchSupport = 'supported') => ({
  ...plainProvider(),
  getAtomicBatchSupport: vi.fn(async (_chainId: number) => support),
  sendAtomicBatch: vi.fn(
    async (_txs: readonly EvmRawTransaction[], _options: { expectedChainId: number }) => 'batch-1',
  ),
  waitForBatch: vi.fn(async (_batchId: string, _options?: { timeout?: number }) => confirmed),
});

const send = (walletProvider: IEvmWalletProvider, timeoutMs = 60_000) =>
  sendApprovalBatch({
    walletProvider,
    srcChainKey: ChainKeys.BASE_MAINNET,
    txs: [APPROVE_TX, DEPOSIT_TX],
    timeoutMs,
    feature: 'bridge',
    context: { action: 'bridgeWithApproval' },
  });

describe('resolveApprovalStrategy', () => {
  it.each([
    ['supported', true, 'atomic-batch'],
    ['ready', true, 'atomic-batch'],
    ['ready', false, 'sequential'],
    ['supported', false, 'atomic-batch'],
    ['unsupported', true, 'sequential'],
  ] as const)('maps %s with allowAccountUpgrade=%s to %s', async (support, allowAccountUpgrade, expected) => {
    const walletProvider = batchProvider(support);
    await expect(
      resolveApprovalStrategy({ srcChainKey: ChainKeys.BASE_MAINNET, walletProvider, allowAccountUpgrade }),
    ).resolves.toBe(expected);
    expect(walletProvider.getAtomicBatchSupport).toHaveBeenCalledWith(BASE_CHAIN_ID);
  });

  it('keeps the Sonic hub sequential without asking the wallet', async () => {
    const walletProvider = batchProvider('supported');
    await expect(resolveApprovalStrategy({ srcChainKey: ChainKeys.SONIC_MAINNET, walletProvider })).resolves.toBe(
      'sequential',
    );
    expect(walletProvider.getAtomicBatchSupport).not.toHaveBeenCalled();
  });

  it('is sequential for a wallet without the batch methods, or one that cannot answer', async () => {
    await expect(
      resolveApprovalStrategy({ srcChainKey: ChainKeys.BASE_MAINNET, walletProvider: plainProvider() }),
    ).resolves.toBe('sequential');

    const throwing = batchProvider();
    throwing.getAtomicBatchSupport.mockRejectedValueOnce(new Error('wallet_getCapabilities unsupported'));
    await expect(
      resolveApprovalStrategy({ srcChainKey: ChainKeys.BASE_MAINNET, walletProvider: throwing }),
    ).resolves.toBe('sequential');
  });
});

describe('sendApprovalBatch', () => {
  it('sends the calls in order on the source chain and returns the deposit tx', async () => {
    const walletProvider = batchProvider();
    const result = await send(walletProvider);

    expect(result).toEqual({ ok: true, value: { txHash: '0xdeposit', batchId: 'batch-1' } });
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledWith([APPROVE_TX, DEPOSIT_TX], {
      expectedChainId: BASE_CHAIN_ID,
    });
    expect(walletProvider.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: 60_000 });
  });

  it('reads the deposit from the last of one receipt per call', async () => {
    const walletProvider = batchProvider();
    walletProvider.waitForBatch.mockResolvedValueOnce({
      ...confirmed,
      receipts: [
        { transactionHash: '0xapprove', status: 'success' },
        { transactionHash: '0xdeposit', status: 'success' },
      ],
    });
    const result = await send(walletProvider);
    expect(result.ok && result.value.txHash).toBe('0xdeposit');
  });

  it('gives up at once on a zero timeout instead of waiting forever', async () => {
    const walletProvider = batchProvider();
    await send(walletProvider, 0);
    expect(walletProvider.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: 1 });
  });

  it('treats a wallet without the batch methods as a refusal, so the caller can approve separately', async () => {
    const result = await send(plainProvider());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INTENT_CREATION_FAILED');
      expect(result.error.feature).toBe('bridge');
      expect(result.error.context).toMatchObject({ reason: ATOMIC_BATCH_REFUSED, action: 'bridgeWithApproval' });
    }
  });

  it('marks a batch the wallet refused before signing', async () => {
    const walletProvider = batchProvider();
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    const result = await send(walletProvider);
    expect(!result.ok && result.error.code).toBe('INTENT_CREATION_FAILED');
    expect(!result.ok && result.error.context?.reason).toBe(ATOMIC_BATCH_REFUSED);
    expect(walletProvider.waitForBatch).not.toHaveBeenCalled();
  });

  it('reports a rejected batch as USER_REJECTED, and a declined upgrade with its reason', async () => {
    const rejecting = batchProvider();
    rejecting.sendAtomicBatch.mockRejectedValueOnce(new UserRejectedRequestError(new Error('User rejected')));
    const rejected = await send(rejecting);
    expect(!rejected.ok && rejected.error.code).toBe('USER_REJECTED');
    expect(!rejected.ok && rejected.error.context?.reason).toBeUndefined();

    const declining = batchProvider('ready');
    declining.sendAtomicBatch.mockRejectedValueOnce(new AtomicReadyWalletRejectedUpgradeError(new Error('declined')));
    const declined = await send(declining);
    expect(!declined.ok && declined.error.code).toBe('USER_REJECTED');
    expect(!declined.ok && declined.error.context?.reason).toBe(ACCOUNT_UPGRADE_DECLINED);
  });

  it.each([400, 500])('reports status %i as a failed batch: nothing landed', async statusCode => {
    const walletProvider = batchProvider();
    walletProvider.waitForBatch.mockResolvedValueOnce({ status: 'failure', statusCode, atomic: true, receipts: [] });
    const result = await send(walletProvider);
    expect(!result.ok && result.error.code).toBe('INTENT_CREATION_FAILED');
    expect(!result.ok && result.error.context).toMatchObject({
      reason: 'atomic-batch-failed',
      batchId: 'batch-1',
      statusCode,
    });
  });

  it.each([
    ['a partial revert (600)', { status: 'failure', statusCode: 600, atomic: true, receipts: [] }],
    ['a reverted deposit receipt', { ...confirmed, receipts: [{ transactionHash: '0xdeposit', status: 'reverted' }] }],
    [
      'receipts that do not identify the deposit',
      {
        ...confirmed,
        receipts: [
          { transactionHash: '0xa', status: 'success' },
          { transactionHash: '0xb', status: 'success' },
          { transactionHash: '0xc', status: 'success' },
        ],
      },
    ],
  ] satisfies [string, EvmBatchResult][])('reports %s as unconfirmed, never as nothing sent', async (_label, batch) => {
    const walletProvider = batchProvider();
    walletProvider.waitForBatch.mockResolvedValueOnce(batch);
    const result = await send(walletProvider);
    expect(!result.ok && result.error.code).toBe('TX_VERIFICATION_FAILED');
    expect(!result.ok && result.error.context).toMatchObject({ reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1' });
  });

  it('reports a wait that throws (e.g. a timeout) as unconfirmed', async () => {
    const walletProvider = batchProvider();
    walletProvider.waitForBatch.mockRejectedValueOnce(new Error('timed out'));
    const result = await send(walletProvider);
    expect(!result.ok && result.error.code).toBe('TX_VERIFICATION_FAILED');
    expect(!result.ok && result.error.context?.reason).toBe(ATOMIC_BATCH_UNCONFIRMED);
  });
});
