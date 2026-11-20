/** Pins the approve-then-deposit helpers: strategy, batch send / confirm, and `runWithApproval` (generic over T, E). */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ApprovalBatchResult,
  ApprovalStrategy,
  ChainKeys,
  EvmRawTransaction,
  Hash,
  IEvmWalletProvider,
  ISolanaWalletProvider,
  Result,
  SodaxError,
} from '../../index.js';
import {
  type approvalBatchWaitMs,
  type confirmApproval,
  confirmApprovalBatch,
  type isAtomicBatchRefusal,
  resolveApprovalStrategy,
  runWithApproval,
  sendApprovalBatch,
} from './approvalBatch.js';

declare const evmWallet: IEvmWalletProvider;
declare const solanaWallet: ISolanaWalletProvider;
declare const txs: EvmRawTransaction[];
declare const BSC: typeof ChainKeys.BSC_MAINNET;
declare const SONIC: typeof ChainKeys.SONIC_MAINNET;
declare const SOLANA: typeof ChainKeys.SOLANA_MAINNET;
declare const batchPath: () => Promise<Result<ApprovalBatchResult, SodaxError<'USER_REJECTED'>>>;
declare const stringPath: () => Promise<Result<string, SodaxError>>;
declare const plainErrorPath: () => Promise<Result<string, Error>>;

type BatchResult = Promise<
  Result<ApprovalBatchResult, SodaxError<'USER_REJECTED' | 'INTENT_CREATION_FAILED' | 'TX_VERIFICATION_FAILED'>>
>;

describe('shared/utils/approvalBatch', () => {
  it('approvalBatchWaitMs and isAtomicBatchRefusal', () => {
    expectTypeOf<ReturnType<typeof approvalBatchWaitMs>>().toEqualTypeOf<number>();
    expectTypeOf<ReturnType<typeof isAtomicBatchRefusal>>().toEqualTypeOf<boolean>();
  });

  it('resolveApprovalStrategy never resolves to not-required', () => {
    const evm = () => resolveApprovalStrategy({ srcChainKey: BSC, walletProvider: evmWallet });
    const nonEvm = () => resolveApprovalStrategy({ srcChainKey: SOLANA, walletProvider: solanaWallet });
    expectTypeOf<ReturnType<typeof evm>>().toEqualTypeOf<Promise<'atomic-batch' | 'sequential'>>();
    expectTypeOf<ReturnType<typeof nonEvm>>().toEqualTypeOf<Promise<'atomic-batch' | 'sequential'>>();
  });

  it('sendApprovalBatch and confirmApprovalBatch resolve to the batch result', () => {
    const send = () =>
      sendApprovalBatch({ walletProvider: evmWallet, srcChainKey: BSC, txs, timeoutMs: 1, feature: 'swap' });
    const confirm = () =>
      confirmApprovalBatch({ walletProvider: evmWallet, batchId: 'b', timeoutMs: 1, feature: 'swap' });
    expectTypeOf<ReturnType<typeof send>>().toEqualTypeOf<BatchResult>();
    expectTypeOf<ReturnType<typeof confirm>>().toEqualTypeOf<BatchResult>();
    expectTypeOf<ApprovalBatchResult>().toEqualTypeOf<{ txHash: Hash; batchId: string }>();
    const hub = () =>
      sendApprovalBatch({
        walletProvider: evmWallet,
        // @ts-expect-error — the hub is not an EVM spoke-only chain
        srcChainKey: SONIC,
        txs,
        timeoutMs: 1,
        feature: 'swap',
      });
    const solana = () =>
      sendApprovalBatch({
        // @ts-expect-error — batches need an EVM wallet provider
        walletProvider: solanaWallet,
        // @ts-expect-error — batches are EVM-spoke-only
        srcChainKey: SOLANA,
        txs,
        timeoutMs: 1,
        feature: 'swap',
      });
    expectTypeOf(hub).toBeFunction();
    expectTypeOf(solana).toBeFunction();
  });

  it('confirmApproval resolves to void or APPROVE_FAILED', () => {
    expectTypeOf<ReturnType<typeof confirmApproval>>().toEqualTypeOf<
      Promise<Result<void, SodaxError<'APPROVE_FAILED'>>>
    >();
  });

  it('runWithApproval carries the path result type through', () => {
    const batch = () =>
      runWithApproval({
        strategy: 'atomic-batch',
        notRequired: batchPath,
        atomicBatch: batchPath,
        sequential: batchPath,
      });
    const str = () =>
      runWithApproval({
        strategy: 'sequential',
        notRequired: stringPath,
        atomicBatch: stringPath,
        sequential: stringPath,
      });
    expectTypeOf<ReturnType<typeof batch>>().toEqualTypeOf<
      Promise<{
        result: Result<ApprovalBatchResult, SodaxError<'USER_REJECTED'>>;
        approvalStrategy: ApprovalStrategy;
      }>
    >();
    expectTypeOf<ReturnType<typeof str>>().toEqualTypeOf<
      Promise<{ result: Result<string, SodaxError>; approvalStrategy: ApprovalStrategy }>
    >();
    const plain = () => {
      const args = {
        strategy: 'sequential',
        notRequired: plainErrorPath,
        atomicBatch: plainErrorPath,
        sequential: plainErrorPath,
      } as const;
      // @ts-expect-error — the error type must be a SodaxError
      return runWithApproval(args);
    };
    expectTypeOf(plain).toBeFunction();
  });
});
