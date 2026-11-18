/**
 * Compile-time contract for `IconSpokeService`: ICON only, `Hex` when signed and `IconRawTransaction`
 * when `raw: true`, with exact gas, read, encoding and receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ChainKeys,
  DepositParams,
  Hex,
  IconRawTransaction,
  IconTransactionResult,
  IEvmWalletProvider,
  IIconWalletProvider,
  Result,
  SendMessageParams,
  WalletBalanceMap,
} from '../../../index.js';
import type { IconSpokeService } from './IconSpokeService.js';

type ICON = typeof ChainKeys.ICON_MAINNET;
type BSC = typeof ChainKeys.BSC_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const svc: IconSpokeService;
declare const icon: IIconWalletProvider;
declare const evm: IEvmWalletProvider;
declare const dep: Flat<DepositParams<ICON, false>>;
declare const msg: Flat<SendMessageParams<ICON, false>>;
declare const bscKey: BSC;

describe('IconSpokeService', () => {
  it('deposit and sendMessage: Hex signed, IconRawTransaction raw, both for a runtime boolean', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: icon }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: icon }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: icon }),
          svc.sendMessage({ ...msg, raw: true }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: icon }),
        ],
      }) as const;
    type Row = readonly [Promise<Hex>, Promise<IconRawTransaction>, Promise<Hex>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{ readonly deposit: Row; readonly sendMessage: Row }>();
    const runtime = (d: DepositParams<ICON, boolean>, m: SendMessageParams<ICON, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m)] as const;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<
      readonly [Promise<Hex | IconRawTransaction>, Promise<Hex | IconRawTransaction>]
    >();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.deposit({ ...dep, raw: true, walletProvider: icon }),
      // @ts-expect-error — ICON needs an ICON wallet provider.
      svc.deposit({ ...dep, walletProvider: evm }),
      // @ts-expect-error — only ICON chain keys are accepted.
      svc.sendMessage({ ...msg, srcChainKey: bscKey, raw: true }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('gas, reads, encoding and receipts pin one result type', () => {
    expectTypeOf<ReturnType<IconSpokeService['estimateGas']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<IconSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<IconSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<IconSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<IconSpokeService['encodeSimulationParams']>>().toEqualTypeOf<{
      encodedToken: Hex;
      encodedSrcAddress: Hex;
    }>();
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<IconSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<IconTransactionResult>>>
    >();
  });
});
