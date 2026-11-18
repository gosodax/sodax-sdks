/**
 * Compile-time contract for `SonicSpokeService`: the Sonic hub only, `Hex` when signed and
 * `EvmRawTransaction` when `raw: true`, including the static swap-intent builder's tuple.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ChainKeys,
  DepositParams,
  EvmRawTransaction,
  EvmRawTransactionReceipt,
  Hex,
  HubAddress,
  IEvmWalletProvider,
  Intent,
  IStellarWalletProvider,
  Result,
  SendMessageParams,
  WalletBalanceMap,
} from '../../../index.js';
import { SonicSpokeService, type CreateSonicSwapIntentParams } from './SonicSpokeService.js';

type SONIC = typeof ChainKeys.SONIC_MAINNET;
type BSC = typeof ChainKeys.BSC_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const svc: SonicSpokeService;
declare const evm: IEvmWalletProvider;
declare const stellar: IStellarWalletProvider;
declare const dep: Flat<DepositParams<SONIC, false>>;
declare const msg: Flat<SendMessageParams<SONIC, false>>;
declare const bscDep: Flat<DepositParams<BSC, false>>;
declare const intentP: Flat<CreateSonicSwapIntentParams<false>>;

describe('SonicSpokeService', () => {
  it('deposit and sendMessage: Hex signed, EvmRawTransaction raw, both for a runtime boolean', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: evm }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: evm }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: evm }),
          svc.sendMessage({ ...msg, raw: true }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: evm }),
        ],
      }) as const;
    type Row = readonly [Promise<Hex>, Promise<EvmRawTransaction>, Promise<Hex>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{ readonly deposit: Row; readonly sendMessage: Row }>();
    const runtime = (d: DepositParams<SONIC, boolean>, m: SendMessageParams<SONIC, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m)] as const;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<
      readonly [Promise<Hex | EvmRawTransaction>, Promise<Hex | EvmRawTransaction>]
    >();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.sendMessage({ ...msg, raw: true, walletProvider: evm }),
      // @ts-expect-error — Sonic needs an EVM wallet provider.
      svc.deposit({ ...dep, walletProvider: stellar }),
      // @ts-expect-error — only the Sonic hub chain is accepted.
      svc.deposit({ ...bscDep, walletProvider: evm }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('createSwapIntent: the tx follows the mode, followed by intent, fee and data', () => {
    const rows = () =>
      [
        SonicSpokeService.createSwapIntent({ ...intentP, walletProvider: evm }),
        SonicSpokeService.createSwapIntent({ ...intentP, raw: true }),
        SonicSpokeService.createSwapIntent({ ...intentP, raw: false, walletProvider: evm }),
      ] as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<
      readonly [
        Promise<[Hex, Intent, bigint, Hex]>,
        Promise<[EvmRawTransaction, Intent, bigint, Hex]>,
        Promise<[Hex, Intent, bigint, Hex]>,
      ]
    >();
    const runtime = (p: CreateSonicSwapIntentParams<boolean>) => SonicSpokeService.createSwapIntent(p);
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<Promise<[Hex | EvmRawTransaction, Intent, bigint, Hex]>>();
    const invalid = () =>
      // @ts-expect-error — raw: true forbids walletProvider.
      SonicSpokeService.createSwapIntent({ ...intentP, raw: true, walletProvider: evm });
    expectTypeOf(invalid).toBeFunction();
  });

  it('reads and receipts pin one result type', () => {
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<SonicSpokeService['isAllowanceValid']>>().toEqualTypeOf<Promise<Result<boolean>>>();
    expectTypeOf<ReturnType<SonicSpokeService['estimateGas']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<SonicSpokeService['getUserRouter']>>().toEqualTypeOf<Promise<HubAddress>>();
    expectTypeOf<ReturnType<SonicSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<SonicSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<SonicSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<SonicSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<EvmRawTransactionReceipt>>>
    >();
  });
});
