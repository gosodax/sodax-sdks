import { describe, expect, it, vi } from 'vitest';
import type { IEvmWalletProvider } from '@sodax/types';
import {
  AtomicityNotSupportedError,
  AtomicReadyWalletRejectedUpgradeError,
  type BaseError,
  MethodNotFoundRpcError,
  TransactionExecutionError,
  UserRejectedRequestError,
} from 'viem';
import {
  canSendAtomicBatch,
  isAccountUpgradeDeclined,
  isAtomicBatchRefused,
  readAtomicBatchSupport,
  type AtomicBatchEvmWalletProvider,
} from './evmAtomicBatch.js';

const baseProvider: IEvmWalletProvider = {
  chainType: 'EVM',
  getWalletAddress: async () => '0x0000000000000000000000000000000000000001',
  sendTransaction: async () => '0xtx',
  waitForTransactionReceipt: vi.fn(),
};

const batchProvider = (getAtomicBatchSupport: AtomicBatchEvmWalletProvider['getAtomicBatchSupport']) => ({
  ...baseProvider,
  getAtomicBatchSupport,
  sendAtomicBatch: vi.fn(),
  waitForBatch: vi.fn(),
});

describe('canSendAtomicBatch', () => {
  it('accepts only a provider implementing all three batch methods', () => {
    expect(canSendAtomicBatch(batchProvider(async () => 'supported'))).toBe(true);
    expect(canSendAtomicBatch(baseProvider)).toBe(false);
    expect(canSendAtomicBatch({ ...baseProvider, getAtomicBatchSupport: async () => 'supported' })).toBe(false);
  });
});

describe('readAtomicBatchSupport', () => {
  it('passes the wallet answer through and forwards the chain id', async () => {
    const getAtomicBatchSupport = vi.fn(async () => 'ready' as const);
    await expect(readAtomicBatchSupport(batchProvider(getAtomicBatchSupport), 42161)).resolves.toBe('ready');
    expect(getAtomicBatchSupport).toHaveBeenCalledWith(42161);
  });

  it('treats a wallet that cannot answer as unsupported', async () => {
    const throwing = batchProvider(async () => {
      throw new Error('Method not found');
    });
    await expect(readAtomicBatchSupport(throwing, 8453)).resolves.toBe('unsupported');
  });
});

describe('isAtomicBatchRefused', () => {
  const wrapped = (cause: BaseError) => new TransactionExecutionError(cause, { account: null });

  it('recognises only a refusal the wallet raised before signing, however viem wraps it', () => {
    expect(isAtomicBatchRefused(wrapped(new AtomicityNotSupportedError(new Error('no'))))).toBe(true);
    expect(isAtomicBatchRefused(wrapped(new MethodNotFoundRpcError(new Error('no'))))).toBe(true);
    expect(isAtomicBatchRefused({ code: 5710 })).toBe(true);
    // A user rejection, a declined upgrade or an unknown error is not a refusal.
    expect(isAtomicBatchRefused(wrapped(new UserRejectedRequestError(new Error('no'))))).toBe(false);
    expect(isAtomicBatchRefused(wrapped(new AtomicReadyWalletRejectedUpgradeError(new Error('no'))))).toBe(false);
    expect(isAtomicBatchRefused(new Error('network down'))).toBe(false);
    expect(isAtomicBatchRefused(undefined)).toBe(false);
  });
});

describe('isAccountUpgradeDeclined', () => {
  const wrapped = (cause: BaseError) => new TransactionExecutionError(cause, { account: null });

  it('recognises only a declined upgrade (5750), however viem wraps it', () => {
    expect(isAccountUpgradeDeclined(wrapped(new AtomicReadyWalletRejectedUpgradeError(new Error('no'))))).toBe(true);
    expect(isAccountUpgradeDeclined({ code: 5750 })).toBe(true);
    // A rejected batch or a refusal is not a declined upgrade.
    expect(isAccountUpgradeDeclined(wrapped(new UserRejectedRequestError(new Error('no'))))).toBe(false);
    expect(isAccountUpgradeDeclined(wrapped(new AtomicityNotSupportedError(new Error('no'))))).toBe(false);
    expect(isAccountUpgradeDeclined(undefined)).toBe(false);
  });
});
