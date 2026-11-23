/**
 * Compile-time contract for `RecoveryService`: `withdrawHubAsset` narrows its result by the spoke chain
 * family and execution mode, inferred from the arguments; `fetchHubAssetBalances` is pinned once.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BitcoinRawTransaction,
  ChainKeys,
  EvmRawTransaction,
  Hex,
  HubAssetBalance,
  IBitcoinWalletProvider,
  IconRawTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  InjectiveRawTransaction,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  NearRawTransaction,
  Result,
  SolanaRawTransaction,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiRawTransaction,
  WithdrawHubAssetParams,
} from '../index.js';
import type { RecoveryService } from './RecoveryService.js';

// [broadcast hash, unsigned transaction] per chain family, spelled out rather than derived from `TxReturnType`.
type Family = {
  sonic: [Hex, EvmRawTransaction];
  bsc: [Hex, EvmRawTransaction];
  icon: [Hex, IconRawTransaction];
  sui: [string, SuiRawTransaction];
  solana: [string, SolanaRawTransaction];
  stellar: [string, StellarRawTransaction];
  injective: [string, InjectiveRawTransaction];
  near: [string, NearRawTransaction];
  stacks: [string, StacksRawTransaction];
  // Bitcoin's raw type already includes the hash string.
  bitcoin: [string, BitcoinRawTransaction | string];
};
// Columns of every matrix row: [walletProvider, raw: false, raw: true, runtime boolean].
// Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
type Modes<Hash, Raw> = [Result<Hash>, Result<Hash>, Result<Raw>, Result<Hash | Raw>];
// Unwraps only an exact Promise, so a sync or `X | Promise<X>` result fails the row it is in.
type Unpromise<P> = [P] extends [Promise<infer V>] ? V : 'not a Promise';
type AwaitAll<T extends readonly unknown[]> = { -readonly [I in keyof T]: Unpromise<T[I]> };
type Settled<T extends Record<string, readonly unknown[]>> = { -readonly [F in keyof T]: AwaitAll<T[F]> };

declare const recovery: RecoveryService;
declare const isRaw: boolean;
declare const w: {
  evm: IEvmWalletProvider;
  icon: IIconWalletProvider;
  sui: ISuiWalletProvider;
  solana: ISolanaWalletProvider;
  stellar: IStellarWalletProvider;
  injective: IInjectiveWalletProvider;
  near: INearWalletProvider;
  stacks: IStacksWalletProvider;
  bitcoin: IBitcoinWalletProvider;
};
declare const p: {
  sonic: WithdrawHubAssetParams<typeof ChainKeys.SONIC_MAINNET>;
  bsc: WithdrawHubAssetParams<typeof ChainKeys.BSC_MAINNET>;
  icon: WithdrawHubAssetParams<typeof ChainKeys.ICON_MAINNET>;
  sui: WithdrawHubAssetParams<typeof ChainKeys.SUI_MAINNET>;
  solana: WithdrawHubAssetParams<typeof ChainKeys.SOLANA_MAINNET>;
  stellar: WithdrawHubAssetParams<typeof ChainKeys.STELLAR_MAINNET>;
  injective: WithdrawHubAssetParams<typeof ChainKeys.INJECTIVE_MAINNET>;
  near: WithdrawHubAssetParams<typeof ChainKeys.NEAR_MAINNET>;
  stacks: WithdrawHubAssetParams<typeof ChainKeys.STACKS_MAINNET>;
  bitcoin: WithdrawHubAssetParams<typeof ChainKeys.BITCOIN_MAINNET>;
};

// Never invoked: each row is one chain family across the four execution modes.
const withdrawRows = () =>
  ({
    sonic: [
      recovery.withdrawHubAsset({ params: p.sonic, walletProvider: w.evm }),
      recovery.withdrawHubAsset({ params: p.sonic, raw: false, walletProvider: w.evm }),
      recovery.withdrawHubAsset({ params: p.sonic, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.sonic, raw: true } : { params: p.sonic, raw: false, walletProvider: w.evm },
      ),
    ],
    bsc: [
      recovery.withdrawHubAsset({ params: p.bsc, walletProvider: w.evm }),
      recovery.withdrawHubAsset({ params: p.bsc, raw: false, walletProvider: w.evm }),
      recovery.withdrawHubAsset({ params: p.bsc, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.bsc, raw: true } : { params: p.bsc, raw: false, walletProvider: w.evm },
      ),
    ],
    icon: [
      recovery.withdrawHubAsset({ params: p.icon, walletProvider: w.icon }),
      recovery.withdrawHubAsset({ params: p.icon, raw: false, walletProvider: w.icon }),
      recovery.withdrawHubAsset({ params: p.icon, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.icon, raw: true } : { params: p.icon, raw: false, walletProvider: w.icon },
      ),
    ],
    sui: [
      recovery.withdrawHubAsset({ params: p.sui, walletProvider: w.sui }),
      recovery.withdrawHubAsset({ params: p.sui, raw: false, walletProvider: w.sui }),
      recovery.withdrawHubAsset({ params: p.sui, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.sui, raw: true } : { params: p.sui, raw: false, walletProvider: w.sui },
      ),
    ],
    solana: [
      recovery.withdrawHubAsset({ params: p.solana, walletProvider: w.solana }),
      recovery.withdrawHubAsset({ params: p.solana, raw: false, walletProvider: w.solana }),
      recovery.withdrawHubAsset({ params: p.solana, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.solana, raw: true } : { params: p.solana, raw: false, walletProvider: w.solana },
      ),
    ],
    stellar: [
      recovery.withdrawHubAsset({ params: p.stellar, walletProvider: w.stellar }),
      recovery.withdrawHubAsset({ params: p.stellar, raw: false, walletProvider: w.stellar }),
      recovery.withdrawHubAsset({ params: p.stellar, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.stellar, raw: true } : { params: p.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    injective: [
      recovery.withdrawHubAsset({ params: p.injective, walletProvider: w.injective }),
      recovery.withdrawHubAsset({ params: p.injective, raw: false, walletProvider: w.injective }),
      recovery.withdrawHubAsset({ params: p.injective, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.injective, raw: true } : { params: p.injective, raw: false, walletProvider: w.injective },
      ),
    ],
    near: [
      recovery.withdrawHubAsset({ params: p.near, walletProvider: w.near }),
      recovery.withdrawHubAsset({ params: p.near, raw: false, walletProvider: w.near }),
      recovery.withdrawHubAsset({ params: p.near, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.near, raw: true } : { params: p.near, raw: false, walletProvider: w.near },
      ),
    ],
    stacks: [
      recovery.withdrawHubAsset({ params: p.stacks, walletProvider: w.stacks }),
      recovery.withdrawHubAsset({ params: p.stacks, raw: false, walletProvider: w.stacks }),
      recovery.withdrawHubAsset({ params: p.stacks, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.stacks, raw: true } : { params: p.stacks, raw: false, walletProvider: w.stacks },
      ),
    ],
    bitcoin: [
      recovery.withdrawHubAsset({ params: p.bitcoin, walletProvider: w.bitcoin }),
      recovery.withdrawHubAsset({ params: p.bitcoin, raw: false, walletProvider: w.bitcoin }),
      recovery.withdrawHubAsset({ params: p.bitcoin, raw: true }),
      recovery.withdrawHubAsset(
        isRaw ? { params: p.bitcoin, raw: true } : { params: p.bitcoin, raw: false, walletProvider: w.bitcoin },
      ),
    ],
  }) as const;

describe('RecoveryService', () => {
  it('withdrawHubAsset: hash per family when signed, unsigned tx with raw: true, both for a runtime boolean', () => {
    expectTypeOf<Settled<ReturnType<typeof withdrawRows>>>().toEqualTypeOf<{
      [F in keyof Family]: Modes<Family[F][0], Family[F][1]>;
    }>();
  });

  it('withdrawHubAsset rejects invalid wallet / mode combinations', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids a walletProvider.
      recovery.withdrawHubAsset({ params: p.bsc, raw: true, walletProvider: w.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      recovery.withdrawHubAsset({ params: p.bsc }),
      // @ts-expect-error — the walletProvider must match the spoke chain family.
      recovery.withdrawHubAsset({ params: p.icon, walletProvider: w.evm }),
    ];
    expectTypeOf(calls).toBeFunction();
  });

  it('fetchHubAssetBalances returns the non-zero hub balances', () => {
    // Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
    expectTypeOf<ReturnType<RecoveryService['fetchHubAssetBalances']>>().toEqualTypeOf<
      Promise<Result<HubAssetBalance[]>>
    >();
  });
});
