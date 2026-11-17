/**
 * Compile-time contract for `SolanaSpokeService`: Solana only, a `string` signature when signed and
 * `SolanaRawTransaction` when `raw: true`, with exact gas, builder, static helper and receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type {
  ChainKeys,
  DepositParams,
  IEvmWalletProvider,
  ISolanaWalletProvider,
  Result,
  SendMessageParams,
  SolanaBase58PublicKey,
  SolanaGasEstimate,
  SolanaRawTransaction,
  SolanaRawTransactionReceipt,
  SolanaRpcResponseAndContext,
  SolanaSerializedTransaction,
  SolanaTokenAmount,
  WalletBalanceMap,
} from '../../../index.js';
import type { SolanaSpokeService } from './SolanaSpokeService.js';

type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const svc: SolanaSpokeService;
declare const solana: ISolanaWalletProvider;
declare const evm: IEvmWalletProvider;
declare const dep: Flat<DepositParams<SOLANA, false>>;
declare const msg: Flat<SendMessageParams<SOLANA, false>>;
declare const btcDep: Flat<DepositParams<BITCOIN, false>>;

describe('SolanaSpokeService', () => {
  it('deposit and sendMessage: string signed, SolanaRawTransaction raw, both for a runtime boolean', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: solana }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: solana }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: solana }),
          svc.sendMessage({ ...msg, raw: true }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: solana }),
        ],
      }) as const;
    type Row = readonly [Promise<string>, Promise<SolanaRawTransaction>, Promise<string>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{ readonly deposit: Row; readonly sendMessage: Row }>();
    const runtime = (d: DepositParams<SOLANA, boolean>, m: SendMessageParams<SOLANA, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m)] as const;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<
      readonly [Promise<string | SolanaRawTransaction>, Promise<string | SolanaRawTransaction>]
    >();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.sendMessage({ ...msg, raw: true, walletProvider: solana }),
      // @ts-expect-error — Solana needs a Solana wallet provider.
      svc.deposit({ ...dep, walletProvider: evm }),
      // @ts-expect-error — only Solana chain keys are accepted.
      svc.deposit({ ...btcDep, raw: true }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('gas, reads, builders and receipts pin one result type', () => {
    expectTypeOf<ReturnType<SolanaSpokeService['estimateGas']>>().toEqualTypeOf<Promise<SolanaGasEstimate>>();
    // The RPC may omit compute units consumed by a simulation, hence the optional estimate.
    expectTypeOf<SolanaGasEstimate>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ReturnType<SolanaSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<SolanaSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<SolanaSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<SolanaSpokeService['buildV0Txn']>>().toEqualTypeOf<Promise<SolanaSerializedTransaction>>();
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<SolanaSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<SolanaRawTransactionReceipt>>>
    >();
  });

  it('static helpers pin one result type', () => {
    expectTypeOf<ReturnType<typeof SolanaSpokeService.getBalance>>().toEqualTypeOf<Promise<number>>();
    expectTypeOf<ReturnType<typeof SolanaSpokeService.getTokenAccountBalance>>().toEqualTypeOf<
      Promise<SolanaRpcResponseAndContext<SolanaTokenAmount>>
    >();
    expectTypeOf<ReturnType<typeof SolanaSpokeService.getMintTokenProgramId>>().toEqualTypeOf<Promise<PublicKey>>();
    expectTypeOf<ReturnType<typeof SolanaSpokeService.getAssociatedTokenAddress>>().toEqualTypeOf<
      Promise<SolanaBase58PublicKey>
    >();
    expectTypeOf<ReturnType<typeof SolanaSpokeService.buildTransactionInstruction>>().toEqualTypeOf<
      TransactionInstruction[]
    >();
  });
});
