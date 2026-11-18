/**
 * Compile-time contract for `SuiSpokeService`: Sui only, a `string` digest when signed and
 * `SuiRawTransaction` when `raw: true`, with exact coin, contract-view, gas and receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { TransactionResult } from '@mysten/sui/transactions';
import type {
  ChainKeys,
  DepositParams,
  Hex,
  IEvmWalletProvider,
  ISuiWalletProvider,
  Result,
  SendMessageParams,
  SuiExecutionResult,
  SuiGasEstimate,
  SuiPaginatedCoins,
  SuiRawTransaction,
  SuiRawTransactionReceipt,
  WalletBalanceMap,
} from '../../../index.js';
import type { SuiSpokeService } from './SuiSpokeService.js';

type SUI = typeof ChainKeys.SUI_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const svc: SuiSpokeService;
declare const sui: ISuiWalletProvider;
declare const evm: IEvmWalletProvider;
declare const dep: Flat<DepositParams<SUI, false>>;
declare const msg: Flat<SendMessageParams<SUI, false>>;
declare const solanaKey: SOLANA;

describe('SuiSpokeService', () => {
  it('deposit and sendMessage: string signed, SuiRawTransaction raw, both for a runtime boolean', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: sui }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: sui }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: sui }),
          svc.sendMessage({ ...msg, raw: true }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: sui }),
        ],
      }) as const;
    type Row = readonly [Promise<string>, Promise<SuiRawTransaction>, Promise<string>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{ readonly deposit: Row; readonly sendMessage: Row }>();
    const runtime = (d: DepositParams<SUI, boolean>, m: SendMessageParams<SUI, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m)] as const;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<
      readonly [Promise<string | SuiRawTransaction>, Promise<string | SuiRawTransaction>]
    >();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.deposit({ ...dep, raw: true, walletProvider: sui }),
      // @ts-expect-error — Sui needs a Sui wallet provider.
      svc.sendMessage({ ...msg, walletProvider: evm }),
      // @ts-expect-error — only Sui chain keys are accepted.
      svc.sendMessage({ ...msg, srcChainKey: solanaKey, raw: true }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('coins, contract views, gas and receipts pin one result type', () => {
    expectTypeOf<ReturnType<SuiSpokeService['getCoins']>>().toEqualTypeOf<Promise<SuiPaginatedCoins>>();
    expectTypeOf<ReturnType<SuiSpokeService['getCoin']>>().toEqualTypeOf<
      Promise<TransactionResult | { $kind: 'Input'; Input: number; type?: 'object' | undefined }>
    >();
    expectTypeOf<ReturnType<SuiSpokeService['splitAddress']>>().toEqualTypeOf<{
      packageId: string;
      moduleId: string;
      stateId: string;
    }>();
    expectTypeOf<ReturnType<SuiSpokeService['getNativeCoin']>>().toEqualTypeOf<
      Promise<{ $kind: 'NestedResult'; NestedResult: [number, number] }>
    >();
    expectTypeOf<ReturnType<SuiSpokeService['encodeSimulationParams']>>().toEqualTypeOf<{
      encodedToken: Hex;
      encodedSrcAddress: Hex;
    }>();
    expectTypeOf<ReturnType<SuiSpokeService['getAssetManagerAddress']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<SuiSpokeService['viewContract']>>().toEqualTypeOf<Promise<SuiExecutionResult>>();
    expectTypeOf<ReturnType<SuiSpokeService['estimateGas']>>().toEqualTypeOf<Promise<SuiGasEstimate>>();
    expectTypeOf<ReturnType<SuiSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<SuiSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<SuiSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<SuiSpokeService['fetchAssetManagerAddress']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<SuiSpokeService['fetchLatestAssetManagerPackageId']>>().toEqualTypeOf<Promise<string>>();
    // Known gap against ADR 0001: never returns ok: false; a never error would break callers that narrow it.
    expectTypeOf<ReturnType<SuiSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<SuiRawTransactionReceipt>>>
    >();
  });
});
