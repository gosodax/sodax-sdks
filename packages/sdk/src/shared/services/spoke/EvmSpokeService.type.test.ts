/**
 * Compile-time contract for `EvmSpokeService`: EVM spoke chains only (not the Sonic hub), `Hex` when
 * signed and `EvmRawTransaction` when `raw: true`, with exact read and receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { HttpTransport, PublicClient } from 'viem';
import type {
  ChainKeys,
  DepositParams,
  EvmRawTransaction,
  EvmRawTransactionReceipt,
  Hex,
  IEvmWalletProvider,
  ISolanaWalletProvider,
  Result,
  SendMessageParams,
  WalletBalanceMap,
} from '../../../index.js';
import type { EvmSpokeService } from './EvmSpokeService.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const svc: EvmSpokeService;
declare const evm: IEvmWalletProvider;
declare const solana: ISolanaWalletProvider;
declare const dep: Flat<DepositParams<BSC, false>>;
declare const msg: Flat<SendMessageParams<BSC, false>>;
declare const sonicDep: Flat<DepositParams<SONIC, false>>;

describe('EvmSpokeService', () => {
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
    const runtime = (d: DepositParams<BSC, boolean>, m: SendMessageParams<BSC, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m)] as const;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<
      readonly [Promise<Hex | EvmRawTransaction>, Promise<Hex | EvmRawTransaction>]
    >();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.deposit({ ...dep, raw: true, walletProvider: evm }),
      // @ts-expect-error — EVM chains need an EVM wallet provider.
      svc.sendMessage({ ...msg, walletProvider: solana }),
      // @ts-expect-error — the Sonic hub is not an EVM spoke chain.
      svc.deposit({ ...sonicDep, walletProvider: evm }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('clients, reads and receipts pin one result type', () => {
    expectTypeOf<ReturnType<EvmSpokeService['getPublicClient']>>().toEqualTypeOf<PublicClient<HttpTransport>>();
    expectTypeOf<ReturnType<EvmSpokeService['constructPublicClient']>>().toEqualTypeOf<PublicClient<HttpTransport>>();
    expectTypeOf<ReturnType<EvmSpokeService['estimateGas']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<EvmSpokeService['isAllowanceValid']>>().toEqualTypeOf<Promise<Result<boolean>>>();
    expectTypeOf<ReturnType<EvmSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<EvmSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<EvmSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<EvmSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<EvmRawTransactionReceipt>>>
    >();
  });
});
