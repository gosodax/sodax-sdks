/**
 * Compile-time contract for `StacksSpokeService`: Stacks only, a `string` txid when signed and
 * `StacksRawTransaction` when `raw: true`, with exact fee, contract-read and receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { ClarityValue } from '@sodax/libs/stacks/core';
import type {
  ChainKeys,
  DepositParams,
  FeeEstimateTransaction,
  IStacksWalletProvider,
  ISuiWalletProvider,
  Result,
  SendMessageParams,
  StacksRawTransaction,
  StacksRawTransactionReceipt,
  WalletBalanceMap,
} from '../../../index.js';
import type { StacksSpokeService } from './StacksSpokeService.js';

type STACKS = typeof ChainKeys.STACKS_MAINNET;
type NEAR = typeof ChainKeys.NEAR_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const svc: StacksSpokeService;
declare const stacks: IStacksWalletProvider;
declare const sui: ISuiWalletProvider;
declare const dep: Flat<DepositParams<STACKS, false>>;
declare const msg: Flat<SendMessageParams<STACKS, false>>;
declare const nearKey: NEAR;

describe('StacksSpokeService', () => {
  it('deposit and sendMessage: string signed, StacksRawTransaction raw, both for a runtime boolean', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: stacks }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: stacks }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: stacks }),
          svc.sendMessage({ ...msg, raw: true }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: stacks }),
        ],
      }) as const;
    type Row = readonly [Promise<string>, Promise<StacksRawTransaction>, Promise<string>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{ readonly deposit: Row; readonly sendMessage: Row }>();
    const runtime = (d: DepositParams<STACKS, boolean>, m: SendMessageParams<STACKS, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m)] as const;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<
      readonly [Promise<string | StacksRawTransaction>, Promise<string | StacksRawTransaction>]
    >();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.deposit({ ...dep, raw: true, walletProvider: stacks }),
      // @ts-expect-error — Stacks needs a Stacks wallet provider.
      svc.sendMessage({ ...msg, walletProvider: sui }),
      // @ts-expect-error — only Stacks chain keys are accepted.
      svc.deposit({ ...dep, srcChainKey: nearKey, raw: true }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('fees, reads and receipts pin one result type', () => {
    expectTypeOf<ReturnType<StacksSpokeService['estimateGas']>>().toEqualTypeOf<Promise<FeeEstimateTransaction>>();
    expectTypeOf<ReturnType<StacksSpokeService['readContract']>>().toEqualTypeOf<Promise<ClarityValue>>();
    expectTypeOf<ReturnType<StacksSpokeService['getSTXBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<StacksSpokeService['readTokenBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<StacksSpokeService['getImplContractAddress']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<StacksSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<StacksSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<StacksSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    // Known gap against ADR 0001: never returns ok: false; a never error would break callers that narrow it.
    expectTypeOf<ReturnType<StacksSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<StacksRawTransactionReceipt>>>
    >();
  });
});
