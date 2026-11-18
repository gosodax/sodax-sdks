/**
 * Compile-time contract for `StellarSpokeService` and `CustomStellarAccount`: Stellar only, a `string`
 * hash when signed and `StellarRawTransaction` when `raw: true`, with exact builder, trustline and
 * receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Account, Operation, rpc, Transaction, xdr } from '@stellar/stellar-sdk';
import type {
  ChainKeys,
  DepositParams,
  Hex,
  IEvmWalletProvider,
  IStellarWalletProvider,
  Result,
  SendMessageParams,
  StellarRawTransaction,
  StellarSorobanTransactionReceipt,
  WalletBalanceMap,
} from '../../../index.js';
import type { CustomStellarAccount, RequestTrustlineParams, StellarSpokeService } from './StellarSpokeService.js';

type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };
type InvokeOp = xdr.Operation<Operation.InvokeHostFunction>;

declare const svc: StellarSpokeService;
declare const stellar: IStellarWalletProvider;
declare const evm: IEvmWalletProvider;
declare const dep: Flat<DepositParams<STELLAR, false>>;
declare const msg: Flat<SendMessageParams<STELLAR, false>>;
declare const trust: Flat<RequestTrustlineParams<STELLAR, false>>;
declare const iconKey: ICON;

describe('StellarSpokeService', () => {
  it('deposit, sendMessage and requestTrustline: string signed, StellarRawTransaction raw', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: stellar }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: stellar }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: stellar }),
          svc.sendMessage({ ...msg, raw: true }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: stellar }),
        ],
        requestTrustline: [
          svc.requestTrustline({ ...trust, walletProvider: stellar }),
          svc.requestTrustline({ ...trust, raw: true }),
          svc.requestTrustline({ ...trust, raw: false, walletProvider: stellar }),
        ],
      }) as const;
    type Row = readonly [Promise<string>, Promise<StellarRawTransaction>, Promise<string>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{
      readonly deposit: Row;
      readonly sendMessage: Row;
      readonly requestTrustline: Row;
    }>();
    const runtime = (
      d: DepositParams<STELLAR, boolean>,
      m: SendMessageParams<STELLAR, boolean>,
      t: RequestTrustlineParams<STELLAR, boolean>,
    ) => [svc.deposit(d), svc.sendMessage(m), svc.requestTrustline(t)] as const;
    type Both = Promise<string | StellarRawTransaction>;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<readonly [Both, Both, Both]>();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.requestTrustline({ ...trust, raw: true, walletProvider: stellar }),
      // @ts-expect-error — Stellar needs a Stellar wallet provider.
      svc.deposit({ ...dep, walletProvider: evm }),
      // @ts-expect-error — only Stellar chain keys are accepted.
      svc.deposit({ ...dep, srcChainKey: iconKey, raw: true }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('operation builders return the invoke-host-function operation in either mode', () => {
    const rows = () =>
      [
        svc.buildDepositCall({ ...dep, walletProvider: stellar }),
        svc.buildDepositCall({ ...dep, raw: true }),
        svc.buildSendMessageCall({ ...msg, walletProvider: stellar }),
        svc.buildSendMessageCall({ ...msg, raw: true }),
      ] as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<readonly [InvokeOp, InvokeOp, InvokeOp, InvokeOp]>();
  });

  it('transaction plumbing, reads and receipts pin one result type', () => {
    expectTypeOf<ReturnType<StellarSpokeService['getBalance']>>().toEqualTypeOf<Promise<number>>();
    expectTypeOf<ReturnType<StellarSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<StellarSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<StellarSpokeService['buildPriorityStellarTransaction']>>().toEqualTypeOf<
      Promise<[Transaction, rpc.Api.SimulateTransactionResponse]>
    >();
    expectTypeOf<ReturnType<StellarSpokeService['signAndSendTransaction']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<StellarSpokeService['submitOrRestoreAndRetry']>>().toEqualTypeOf<Promise<string>>();
    expectTypeOf<ReturnType<typeof StellarSpokeService.getAddressBCSBytes>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<typeof StellarSpokeService.getTsWalletBytes>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<StellarSpokeService['requiresTrustline']>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<StellarSpokeService['hasSufficientTrustline']>>().toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<ReturnType<StellarSpokeService['estimateGas']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<StellarSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<StellarSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<StellarSorobanTransactionReceipt>>>
    >();
  });
});

describe('CustomStellarAccount', () => {
  it('sequence accessors and mutators pin one result type', () => {
    expectTypeOf<ReturnType<CustomStellarAccount['getSequenceNumber']>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<CustomStellarAccount['getStartingSequenceNumber']>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<CustomStellarAccount['getAccountId']>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<CustomStellarAccount['getAccountClone']>>().toEqualTypeOf<Account>();
    expectTypeOf<ReturnType<CustomStellarAccount['incrementSequenceNumber']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<CustomStellarAccount['decrementSequenceNumber']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<CustomStellarAccount['resetSequenceNumber']>>().toEqualTypeOf<void>();
  });
});
