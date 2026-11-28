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
import { expectErr, expectOk } from '../../test-utils/result.js';
import { mockEvmWalletProvider } from '../../test-utils/walletProviders.js';

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

/** A wallet without the EIP-5792 batch methods. */
const plainProvider = (): IEvmWalletProvider => mockEvmWalletProvider();

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
  it('maps the wallet batch support and allowAccountUpgrade to a strategy', async () => {
    const rows = [
      ['supported', false, 'atomic-batch'],
      ['ready', true, 'atomic-batch'],
      ['ready', false, 'sequential'],
      ['unsupported', true, 'sequential'],
    ] as const;
    for (const [support, allowAccountUpgrade, expected] of rows) {
      const label = `${support}, allowAccountUpgrade=${allowAccountUpgrade}`;
      const walletProvider = batchProvider(support);
      await expect(
        resolveApprovalStrategy({ srcChainKey: ChainKeys.BASE_MAINNET, walletProvider, allowAccountUpgrade }),
        label,
      ).resolves.toBe(expected);
      expect(walletProvider.getAtomicBatchSupport, label).toHaveBeenCalledWith(BASE_CHAIN_ID);
    }
  });

  it('is sequential on the Sonic hub (without asking), for a wallet without batch methods, or one that cannot answer', async () => {
    const hubWallet = batchProvider('supported');
    await expect(
      resolveApprovalStrategy({ srcChainKey: ChainKeys.SONIC_MAINNET, walletProvider: hubWallet }),
    ).resolves.toBe('sequential');
    expect(hubWallet.getAtomicBatchSupport).not.toHaveBeenCalled();

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
  it('sends the calls in order on the source chain, reports the batch id before waiting, and returns the deposit tx', async () => {
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

    expect(result).toEqual({ ok: true, value: { txHash: '0xdeposit', batchId: 'batch-1' } });
    expect(order).toEqual(['sent:batch-1', 'wait']);
    expect(walletProvider.sendAtomicBatch).toHaveBeenCalledWith([APPROVE_TX, DEPOSIT_TX], {
      expectedChainId: BASE_CHAIN_ID,
    });
    expect(walletProvider.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: 60_000 });
  });

  it('reads the deposit from the last receipt, whether one receipt per call or all sharing one tx', async () => {
    const perCall = batchProvider();
    perCall.waitForBatch.mockResolvedValueOnce({
      ...confirmed,
      receipts: [
        { transactionHash: '0xapprove', status: 'success' },
        { transactionHash: '0xdeposit', status: 'success' },
      ],
    });
    expect(expectOk(await send(perCall)).txHash).toBe('0xdeposit');

    // A wallet may add its own call to the one tx, so the receipt count exceeds the call count.
    const sharedTx = batchProvider();
    const receipt = { transactionHash: '0xdeposit', status: 'success' } as const;
    sharedTx.waitForBatch.mockResolvedValueOnce({ ...confirmed, receipts: [receipt, receipt, receipt] });
    expect(expectOk(await send(sharedTx)).txHash).toBe('0xdeposit');
  });

  it('gives up at once on a zero timeout instead of waiting forever', async () => {
    const walletProvider = batchProvider();
    await send(walletProvider, 0);
    expect(walletProvider.waitForBatch).toHaveBeenCalledWith('batch-1', { timeout: 1 });
  });

  it('marks a wallet without the batch methods, or a batch it refused before signing, as a refusal', async () => {
    const error = expectErr(await send(plainProvider()), 'INTENT_CREATION_FAILED', {
      reason: ATOMIC_BATCH_REFUSED,
      action: 'bridgeWithApproval',
    });
    expect(error.feature).toBe('bridge');

    const walletProvider = batchProvider();
    walletProvider.sendAtomicBatch.mockRejectedValueOnce(new AtomicityNotSupportedError(new Error('no atomicity')));
    expectErr(await send(walletProvider), 'INTENT_CREATION_FAILED', { reason: ATOMIC_BATCH_REFUSED });
    expect(walletProvider.waitForBatch).not.toHaveBeenCalled();
  });

  it('reports a rejected batch as USER_REJECTED, and a declined upgrade with its reason', async () => {
    const rejecting = batchProvider();
    rejecting.sendAtomicBatch.mockRejectedValueOnce(new UserRejectedRequestError(new Error('User rejected')));
    expect(expectErr(await send(rejecting), 'USER_REJECTED').context?.reason).toBeUndefined();

    const declining = batchProvider('ready');
    declining.sendAtomicBatch.mockRejectedValueOnce(new AtomicReadyWalletRejectedUpgradeError(new Error('declined')));
    expectErr(await send(declining), 'USER_REJECTED', { reason: ACCOUNT_UPGRADE_DECLINED });
  });

  it('reports statuses 400 and 500 as a failed batch: nothing landed', async () => {
    for (const statusCode of [400, 500]) {
      const walletProvider = batchProvider();
      walletProvider.waitForBatch.mockResolvedValueOnce({ status: 'failure', statusCode, atomic: true, receipts: [] });
      expectErr(
        await send(walletProvider),
        'INTENT_CREATION_FAILED',
        { reason: 'atomic-batch-failed', batchId: 'batch-1', statusCode },
        String(statusCode),
      );
    }
  });

  it('reports a partial revert, a reverted deposit receipt or unidentifiable receipts as unconfirmed, never as nothing sent', async () => {
    const batches: Array<[label: string, batch: EvmBatchResult]> = [
      ['a partial revert (600)', { status: 'failure', statusCode: 600, atomic: true, receipts: [] }],
      [
        'a reverted deposit receipt',
        { ...confirmed, receipts: [{ transactionHash: '0xdeposit', status: 'reverted' }] },
      ],
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
    ];
    for (const [label, batch] of batches) {
      const walletProvider = batchProvider();
      walletProvider.waitForBatch.mockResolvedValueOnce(batch);
      expectErr(
        await send(walletProvider),
        'TX_VERIFICATION_FAILED',
        { reason: ATOMIC_BATCH_UNCONFIRMED, batchId: 'batch-1', callCount: 2 },
        label,
      );
    }
  });

  it('does not call onBatchSent for a batch the wallet never accepted, and a throwing listener costs nothing', async () => {
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
    expect(expectOk(result).txHash).toBe('0xdeposit');
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

  // A plain sequential run is told to validate first (`false`); only the refused-batch fallback skips it.
  it('runs only the path of the chosen strategy', async () => {
    const rows = [
      ['not-required', 'notRequired', 'direct', []],
      ['sequential', 'sequential', 'approved-first', [false]],
      ['atomic-batch', 'atomicBatch', 'batch', []],
    ] as const;
    for (const [strategy, path, value, args] of rows) {
      const p = paths();
      const { result, approvalStrategy } = await runWithApproval({ strategy, ...p });
      expect(result, strategy).toEqual({ ok: true, value });
      expect(approvalStrategy, strategy).toBe(strategy);
      expect(
        Object.values(p).filter(fn => fn.mock.calls.length > 0),
        strategy,
      ).toEqual([p[path]]);
      expect(p[path], strategy).toHaveBeenCalledWith(...args);
    }
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

  it('never approves separately after a rejected, failed or unconfirmed batch', async () => {
    for (const outcome of [
      failed('USER_REJECTED'),
      failed('INTENT_CREATION_FAILED', 'atomic-batch-failed'),
      failed('TX_VERIFICATION_FAILED', ATOMIC_BATCH_UNCONFIRMED),
    ]) {
      const p = paths();
      p.atomicBatch.mockResolvedValueOnce(outcome as never);

      const { result, approvalStrategy } = await runWithApproval({ strategy: 'atomic-batch', ...p });

      expect(result).toBe(outcome);
      expect(approvalStrategy).toBe('atomic-batch');
      expect(p.sequential).not.toHaveBeenCalled();
    }
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
    expectErr(await resume(walletProvider), undefined, {
      reason: ATOMIC_BATCH_UNCONFIRMED,
      batchId: 'batch-1',
      callCount: 2,
    });

    expectErr(await resume(plainProvider()), undefined, { reason: ATOMIC_BATCH_UNCONFIRMED });
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

    const split = expectErr(await resumeUncounted(), undefined, { reason: ATOMIC_BATCH_UNCONFIRMED });
    expect(split.context).not.toHaveProperty('callCount');
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
