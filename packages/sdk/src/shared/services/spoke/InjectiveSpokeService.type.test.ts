/**
 * Compile-time contract for `InjectiveSpokeService`: Injective only, a `string` hash when signed and
 * `InjectiveRawTransaction` when `raw: true`, with exact admin, read and receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ChainKeys,
  DepositParams,
  IEvmWalletProvider,
  IInjectiveWalletProvider,
  InjectiveExecuteResponse,
  InjectiveGasEstimate,
  InjectiveRawTransaction,
  InjectiveRawTransactionReceipt,
  Result,
  SendMessageParams,
  WalletBalanceMap,
} from '../../../index.js';
import type { InjectiveSpokeService, State } from './InjectiveSpokeService.js';

type INJECTIVE = typeof ChainKeys.INJECTIVE_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const svc: InjectiveSpokeService;
declare const injective: IInjectiveWalletProvider;
declare const evm: IEvmWalletProvider;
declare const dep: Flat<DepositParams<INJECTIVE, false>>;
declare const msg: Flat<SendMessageParams<INJECTIVE, false>>;
declare const suiKey: SUI;

describe('InjectiveSpokeService', () => {
  it('deposit and sendMessage: string signed, InjectiveRawTransaction raw, both for a runtime boolean', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: injective }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: injective }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: injective }),
          svc.sendMessage({ ...msg, raw: true }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: injective }),
        ],
      }) as const;
    type Row = readonly [Promise<string>, Promise<InjectiveRawTransaction>, Promise<string>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{ readonly deposit: Row; readonly sendMessage: Row }>();
    const runtime = (d: DepositParams<INJECTIVE, boolean>, m: SendMessageParams<INJECTIVE, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m)] as const;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<
      readonly [Promise<string | InjectiveRawTransaction>, Promise<string | InjectiveRawTransaction>]
    >();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.sendMessage({ ...msg, raw: true, walletProvider: injective }),
      // @ts-expect-error — Injective needs an Injective wallet provider.
      svc.deposit({ ...dep, walletProvider: evm }),
      // @ts-expect-error — only Injective chain keys are accepted.
      svc.deposit({ ...dep, srcChainKey: suiKey, raw: true }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('gas, reads, admin calls and receipts pin one result type', () => {
    expectTypeOf<ReturnType<InjectiveSpokeService['estimateGas']>>().toEqualTypeOf<Promise<InjectiveGasEstimate>>();
    expectTypeOf<InjectiveGasEstimate>().toEqualTypeOf<{ gasWanted: number; gasUsed: number }>();
    expectTypeOf<ReturnType<InjectiveSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<InjectiveSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<InjectiveSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<InjectiveSpokeService['getRawTransaction']>>().toEqualTypeOf<
      Promise<InjectiveRawTransaction>
    >();
    expectTypeOf<ReturnType<InjectiveSpokeService['getState']>>().toEqualTypeOf<Promise<State>>();
    expectTypeOf<State>().toEqualTypeOf<{
      connection: string;
      rate_limit: string;
      hub_asset_manager: Uint8Array;
      hub_chain_id: string;
      owner: string;
    }>();
    expectTypeOf<ReturnType<InjectiveSpokeService['receiveMessage']>>().toEqualTypeOf<
      Promise<InjectiveExecuteResponse>
    >();
    expectTypeOf<ReturnType<InjectiveSpokeService['setRateLimit']>>().toEqualTypeOf<
      Promise<InjectiveExecuteResponse>
    >();
    expectTypeOf<ReturnType<InjectiveSpokeService['setConnection']>>().toEqualTypeOf<
      Promise<InjectiveExecuteResponse>
    >();
    expectTypeOf<ReturnType<InjectiveSpokeService['setOwner']>>().toEqualTypeOf<Promise<InjectiveExecuteResponse>>();
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<InjectiveSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<InjectiveRawTransactionReceipt>>>
    >();
  });
});
