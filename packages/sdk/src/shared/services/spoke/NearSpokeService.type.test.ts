/**
 * Compile-time contract for `NearSpokeService`: NEAR only, a `string` hash when signed and
 * `NearRawTransaction` when `raw: true`, with exact storage, limit, read and receipt types.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ChainKeys,
  DepositParams,
  IEvmWalletProvider,
  INearWalletProvider,
  NearRawTransaction,
  NearRawTransactionReceipt,
  RateLimitConfig,
  Result,
  SendMessageParams,
  WalletBalanceMap,
} from '../../../index.js';
import type { NearSpokeService, QueryResponse } from './NearSpokeService.js';

type NEAR = typeof ChainKeys.NEAR_MAINNET;
type STACKS = typeof ChainKeys.STACKS_MAINNET;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Receipt<R> = { status: 'success'; receipt: R } | { error: Error; status: 'failure' | 'timeout' };

declare const svc: NearSpokeService;
declare const near: INearWalletProvider;
declare const evm: IEvmWalletProvider;
declare const isRaw: boolean;
declare const dep: Flat<DepositParams<NEAR, false>>;
declare const msg: Flat<SendMessageParams<NEAR, false>>;
declare const stacksMsg: Flat<SendMessageParams<STACKS, false>>;

describe('NearSpokeService', () => {
  it('deposit and sendMessage: string signed, NearRawTransaction raw, both for a runtime boolean', () => {
    const rows = () =>
      ({
        deposit: [
          svc.deposit({ ...dep, walletProvider: near }),
          svc.deposit({ ...dep, raw: true }),
          svc.deposit({ ...dep, raw: false, walletProvider: near }),
        ],
        sendMessage: [
          svc.sendMessage({ ...msg, walletProvider: near }),
          svc.sendMessage({ ...msg, raw: true }),
          svc.sendMessage({ ...msg, raw: false, walletProvider: near }),
        ],
      }) as const;
    type Row = readonly [Promise<string>, Promise<NearRawTransaction>, Promise<string>];
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<{ readonly deposit: Row; readonly sendMessage: Row }>();
    const runtime = (d: DepositParams<NEAR, boolean>, m: SendMessageParams<NEAR, boolean>) =>
      [svc.deposit(d), svc.sendMessage(m)] as const;
    expectTypeOf<ReturnType<typeof runtime>>().toEqualTypeOf<
      readonly [Promise<string | NearRawTransaction>, Promise<string | NearRawTransaction>]
    >();
    const invalid = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.deposit({ ...dep, raw: true, walletProvider: near }),
      // @ts-expect-error — NEAR needs a NEAR wallet provider.
      svc.sendMessage({ ...msg, walletProvider: evm }),
      // @ts-expect-error — only NEAR chain keys are accepted.
      svc.sendMessage({ ...stacksMsg, raw: true }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });

  it('registerStorage: the result follows `raw`, and the wallet provider is always required', () => {
    const base = { token: 'usdc.near', accountId: 'alice.near' };
    const rows = () =>
      [
        svc.registerStorage({ ...base, walletProvider: near }),
        svc.registerStorage({ ...base, walletProvider: near, raw: true }),
        svc.registerStorage({ ...base, walletProvider: near, raw: false }),
        svc.registerStorage({ ...base, walletProvider: near, raw: isRaw }),
      ] as const;
    expectTypeOf<ReturnType<typeof rows>>().toEqualTypeOf<
      readonly [Promise<string>, Promise<NearRawTransaction>, Promise<string>, Promise<string | NearRawTransaction>]
    >();
    const invalid = () =>
      // @ts-expect-error — unlike WalletProviderSlot, raw mode still requires the wallet provider.
      svc.registerStorage({ ...base, raw: true });
    expectTypeOf(invalid).toBeFunction();
  });

  it('gas, reads, limits and receipts pin one result type', () => {
    expectTypeOf<ReturnType<NearSpokeService['estimateGas']>>().toEqualTypeOf<Promise<bigint>>();
    // Contract view results are arbitrary JSON from the queried contract, so the union is deliberately wide.
    expectTypeOf<ReturnType<NearSpokeService['queryContract']>>().toEqualTypeOf<Promise<QueryResponse>>();
    expectTypeOf<QueryResponse>().toEqualTypeOf<string | number | boolean | object | undefined>();
    expectTypeOf<ReturnType<NearSpokeService['getRateLimit']>>().toEqualTypeOf<Promise<RateLimitConfig>>();
    expectTypeOf<ReturnType<NearSpokeService['fillIntent']>>().toEqualTypeOf<Promise<NearRawTransaction>>();
    expectTypeOf<ReturnType<NearSpokeService['getDeposit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<NearSpokeService['getWalletBalance']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<NearSpokeService['getWalletBalances']>>().toEqualTypeOf<Promise<WalletBalanceMap>>();
    expectTypeOf<ReturnType<NearSpokeService['isStorageRegistered']>>().toEqualTypeOf<Promise<boolean>>();
    expectTypeOf<ReturnType<NearSpokeService['getLimit']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<NearSpokeService['getAvailable']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<NearSpokeService['waitForTransactionReceipt']>>().toEqualTypeOf<
      Promise<Result<Receipt<NearRawTransactionReceipt>>>
    >();
  });
});
