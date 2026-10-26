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
  confirmApprovalBatch,
  isAtomicBatchRefusal,
  resolveApprovalStrategy,
  runWithApproval,
  sendApprovalBatch,
} from './approvalBatch.js';
import { SodaxError } from '../../errors/SodaxError.js';

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

  it('reads the deposit from receipts that all share one tx, even with a call the wallet added', async () => {
    const walletProvider = batchProvider();
    const receipt = { transactionHash: '0xdeposit', status: 'success' } as const;
    walletProvider.waitForBatch.mockResolvedValueOnce({ ...confirmed, receipts: [receipt, receipt, receipt] });
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
    expect(!result.ok && result.error.context).toMatchObject({
      reason: ATOMIC_BATCH_UNCONFIRMED,
      batchId: 'batch-1',
      callCount: 2,
    });
  });

  it('reports a wait that throws (e.g. a timeout) as unconfirmed', async () => {
    const walletProvider = batchProvider();
    walletProvider.waitForBatch.mockRejectedValueOnce(new Error('timed out'));
    const result = await send(walletProvider);
    expect(!result.ok && result.error.code).toBe('TX_VERIFICATION_FAILED');
    expect(!result.ok && result.error.context?.reason).toBe(ATOMIC_BATCH_UNCONFIRMED);
  });
});

describe('runWithApproval', () => {
  const paths = () => ({
    notRequired: vi.fn(async () => ({ ok: true as const, value: 'direct' })),
    atomicBatch: vi.fn(async () => ({ ok: true as const, value: 'batch' })),
    sequential: vi.fn(async () => ({ ok: true as const, value: 'approved-first' })),
  });
  const failed = (code: 'INTENT_CREATION_FAILED' | 'USER_REJECTED' | 'TX_VERIFICATION_FAILED', reason?: string) => ({
    ok: false as const,
    error: new SodaxError(code, 'batch failed', { feature: 'bridge', context: { reason } }),
  });

  it.each([
    ['not-required', 'notRequired', 'direct'],
    ['sequential', 'sequential', 'approved-first'],
    ['atomic-batch', 'atomicBatch', 'batch'],
  ] as const)('runs only the %s path', async (strategy, path, value) => {
    const p = paths();
    const { result, approvalStrategy } = await runWithApproval({ strategy, ...p });
    expect(result).toEqual({ ok: true, value });
    expect(approvalStrategy).toBe(strategy);
    expect(Object.values(p).filter(fn => fn.mock.calls.length > 0)).toEqual([p[path]]);
  });

  it('approves separately when the wallet refused the batch before signing', async () => {
    const p = paths();
    const refusal = failed('INTENT_CREATION_FAILED', ATOMIC_BATCH_REFUSED);
    p.atomicBatch.mockResolvedValueOnce(refusal as never);
    const onBatchRefused = vi.fn();

    const { result, approvalStrategy } = await runWithApproval({ strategy: 'atomic-batch', ...p, onBatchRefused });

    expect(result).toEqual({ ok: true, value: 'approved-first' });
    expect(approvalStrategy).toBe('sequential');
    expect(onBatchRefused).toHaveBeenCalledWith(refusal.error);
    // The batch path already built the deposit, so the fallback is told it needs no second validation.
    expect(p.sequential).toHaveBeenCalledWith(true);
  });

  it('tells a plain sequential run to validate first', async () => {
    const p = paths();
    await runWithApproval({ strategy: 'sequential', ...p });
    expect(p.sequential).toHaveBeenCalledWith(false);
  });

  it.each([
    ['a rejected batch', failed('USER_REJECTED')],
    ['a failed batch', failed('INTENT_CREATION_FAILED', 'atomic-batch-failed')],
    ['an unconfirmed batch', failed('TX_VERIFICATION_FAILED', ATOMIC_BATCH_UNCONFIRMED)],
  ])('never approves separately after %s', async (_label, outcome) => {
    const p = paths();
    p.atomicBatch.mockResolvedValueOnce(outcome as never);

    const { result, approvalStrategy } = await runWithApproval({ strategy: 'atomic-batch', ...p });

    expect(result).toBe(outcome);
    expect(approvalStrategy).toBe('atomic-batch');
    expect(p.sequential).not.toHaveBeenCalled();
  });
});

describe('sendApprovalBatch — onBatchSent', () => {
  it('reports the batch id once the wallet accepts it, before waiting', async () => {
    const walletProvider = batchProvider();
    const order: string[] = [];
    walletProvider.waitForBatch.mockImplementationOnce(async () => {
      order.push('wait');
      return confirmed;
    });

    const result = await sendApprovalBatch({
      walletProvider,
      srcChainKey: ChainKeys.BASE_MAINNET,
      txs: [APPROVE_TX, DEPOSIT_TX],
      timeoutMs: 60_000,
      feature: 'swap',
      onBatchSent: batchId => order.push(`sent:${batchId}`),
    });

    expect(result.ok).toBe(true);
    expect(order).toEqual(['sent:batch-1', 'wait']);
  });

  it('is not called for a batch the wallet never accepted, and a throwing listener costs nothing', async () => {
    const refusing = batchProvider();
    refusing.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    const onBatchSent = vi.fn();
    await sendApprovalBatch({
      walletProvider: refusing,
      srcChainKey: ChainKeys.BASE_MAINNET,
      txs: [APPROVE_TX, DEPOSIT_TX],
      timeoutMs: 60_000,
      feature: 'swap',
      onBatchSent,
    });
    expect(onBatchSent).not.toHaveBeenCalled();

    const result = await sendApprovalBatch({
      walletProvider: batchProvider(),
      srcChainKey: ChainKeys.BASE_MAINNET,
      txs: [APPROVE_TX, DEPOSIT_TX],
      timeoutMs: 60_000,
      feature: 'swap',
      onBatchSent: () => {
        throw new Error('storage full');
      },
    });
    expect(result.ok && result.value.txHash).toBe('0xdeposit');
  });
});

describe('confirmApprovalBatch', () => {
  const resume = (walletProvider: IEvmWalletProvider, callCount = 2) =>
    confirmApprovalBatch({ walletProvider, batchId: 'batch-1', callCount, timeoutMs: 15_000, feature: 'swap' });

  it('resumes a batch the wallet already accepted and reads the deposit from it', async () => {
    const walletProvider = batchProvider();
    await expect(resume(walletProvider)).resolves.toEqual({
      ok: true,
      value: { txHash: '0xdeposit', batchId: 'batch-1' },
    });
    expect(walletProvider.sendAtomicBatch).not.toHaveBeenCalled();
    expect(walletProvider.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: 15_000 });
  });

  it('keeps a batch the wallet still cannot answer for unconfirmed', async () => {
    const walletProvider = batchProvider();
    walletProvider.waitForBatch.mockRejectedValueOnce(new Error('unknown bundle id'));
    const result = await resume(walletProvider);
    expect(!result.ok && result.error.context).toMatchObject({
      reason: ATOMIC_BATCH_UNCONFIRMED,
      batchId: 'batch-1',
      callCount: 2,
    });

    const plain = await resume(plainProvider());
    expect(!plain.ok && plain.error.context?.reason).toBe(ATOMIC_BATCH_UNCONFIRMED);
  });

  it('without callCount, reads the deposit only from receipts that share one tx', async () => {
    const walletProvider = batchProvider();
    walletProvider.waitForBatch.mockResolvedValueOnce({
      ...confirmed,
      receipts: [
        { transactionHash: '0xapprove', status: 'success' },
        { transactionHash: '0xdeposit', status: 'success' },
      ],
    });
    const resumeUncounted = () =>
      confirmApprovalBatch({ walletProvider, batchId: 'batch-1', timeoutMs: 15_000, feature: 'swap' });

    const split = await resumeUncounted();
    expect(!split.ok && split.error.context?.reason).toBe(ATOMIC_BATCH_UNCONFIRMED);
    expect(!split.ok && split.error.context).not.toHaveProperty('callCount');
    await expect(resumeUncounted()).resolves.toMatchObject({ ok: true, value: { txHash: '0xdeposit' } });
  });
});

describe('isAtomicBatchRefusal', () => {
  it('matches only a batch refused before signing', () => {
    const refused = new SodaxError('INTENT_CREATION_FAILED', 'refused', {
      feature: 'swap',
      context: { reason: ATOMIC_BATCH_REFUSED },
    });
    const failed = new SodaxError('INTENT_CREATION_FAILED', 'failed', {
      feature: 'swap',
      context: { reason: 'atomic-batch-failed' },
    });
    const unconfirmed = new SodaxError('TX_VERIFICATION_FAILED', 'unconfirmed', {
      feature: 'swap',
      context: { reason: ATOMIC_BATCH_REFUSED },
    });
    expect(isAtomicBatchRefusal(refused)).toBe(true);
    expect(isAtomicBatchRefusal(failed)).toBe(false);
    expect(isAtomicBatchRefusal(unconfirmed)).toBe(false);
    expect(isAtomicBatchRefusal(new Error('refused'))).toBe(false);
  });
});
