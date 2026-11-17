/**
 * Compile-time contract for `BridgeService`: every public method's exact result type, and for the
 * chain- and mode-generic actions the result per chain family and execution mode, inferred from the
 * arguments with no type arguments. Enforced by `pnpm checkTs`; no-ops under vitest.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ApprovalStrategy,
  BitcoinRawTransaction,
  BridgeAllowanceCheckError,
  BridgeApproveError,
  BridgeCreateIntentError,
  BridgeDetailedStatusError,
  BridgeLimit,
  BridgeLookupError,
  BridgeOrchestrationError,
  BridgeWithApprovalError,
  ChainKeys,
  CreateBridgeIntentParams,
  DetailedBridgeStatus,
  EvmRawTransaction,
  Hex,
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
  RelayExtraData,
  Result,
  SolanaRawTransaction,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiRawTransaction,
  TxHashPair,
  XToken,
} from '../index.js';
import type { BridgeService } from './BridgeService.js';

type SONIC = typeof ChainKeys.SONIC_MAINNET;
type BSC = typeof ChainKeys.BSC_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;
type SOLANA = typeof ChainKeys.SOLANA_MAINNET;
type STELLAR = typeof ChainKeys.STELLAR_MAINNET;
type INJECTIVE = typeof ChainKeys.INJECTIVE_MAINNET;
type NEAR = typeof ChainKeys.NEAR_MAINNET;
type STACKS = typeof ChainKeys.STACKS_MAINNET;
type BITCOIN = typeof ChainKeys.BITCOIN_MAINNET;

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
type Modes<Hash, Raw, E> = [Result<Hash, E>, Result<Hash, E>, Result<Raw, E>, Result<Hash | Raw, E>];
type AwaitAll<T extends readonly unknown[]> = { -readonly [I in keyof T]: Awaited<T[I]> };
type Settled<T extends Record<string, readonly unknown[]>> = { -readonly [F in keyof T]: AwaitAll<T[F]> };
type Unwrapped<T> = { -readonly [F in keyof T]: Awaited<T[F]> };
type Intented<Tx> = { tx: Tx; relayData: RelayExtraData };

declare const bridge: BridgeService;
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
  sonic: CreateBridgeIntentParams<SONIC>;
  bsc: CreateBridgeIntentParams<BSC>;
  icon: CreateBridgeIntentParams<ICON>;
  sui: CreateBridgeIntentParams<SUI>;
  solana: CreateBridgeIntentParams<SOLANA>;
  stellar: CreateBridgeIntentParams<STELLAR>;
  injective: CreateBridgeIntentParams<INJECTIVE>;
  near: CreateBridgeIntentParams<NEAR>;
  stacks: CreateBridgeIntentParams<STACKS>;
  bitcoin: CreateBridgeIntentParams<BITCOIN>;
};

// Never invoked: each row is one chain family across the four execution modes.
const approveRows = () =>
  ({
    sonic: [
      bridge.approve({ params: p.sonic, walletProvider: w.evm }),
      bridge.approve({ params: p.sonic, raw: false, walletProvider: w.evm }),
      bridge.approve({ params: p.sonic, raw: true }),
      bridge.approve(isRaw ? { params: p.sonic, raw: true } : { params: p.sonic, raw: false, walletProvider: w.evm }),
    ],
    bsc: [
      bridge.approve({ params: p.bsc, walletProvider: w.evm }),
      bridge.approve({ params: p.bsc, raw: false, walletProvider: w.evm }),
      bridge.approve({ params: p.bsc, raw: true }),
      bridge.approve(isRaw ? { params: p.bsc, raw: true } : { params: p.bsc, raw: false, walletProvider: w.evm }),
    ],
    icon: [
      bridge.approve({ params: p.icon, walletProvider: w.icon }),
      bridge.approve({ params: p.icon, raw: false, walletProvider: w.icon }),
      bridge.approve({ params: p.icon, raw: true }),
      bridge.approve(isRaw ? { params: p.icon, raw: true } : { params: p.icon, raw: false, walletProvider: w.icon }),
    ],
    sui: [
      bridge.approve({ params: p.sui, walletProvider: w.sui }),
      bridge.approve({ params: p.sui, raw: false, walletProvider: w.sui }),
      bridge.approve({ params: p.sui, raw: true }),
      bridge.approve(isRaw ? { params: p.sui, raw: true } : { params: p.sui, raw: false, walletProvider: w.sui }),
    ],
    solana: [
      bridge.approve({ params: p.solana, walletProvider: w.solana }),
      bridge.approve({ params: p.solana, raw: false, walletProvider: w.solana }),
      bridge.approve({ params: p.solana, raw: true }),
      bridge.approve(
        isRaw ? { params: p.solana, raw: true } : { params: p.solana, raw: false, walletProvider: w.solana },
      ),
    ],
    stellar: [
      bridge.approve({ params: p.stellar, walletProvider: w.stellar }),
      bridge.approve({ params: p.stellar, raw: false, walletProvider: w.stellar }),
      bridge.approve({ params: p.stellar, raw: true }),
      bridge.approve(
        isRaw ? { params: p.stellar, raw: true } : { params: p.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    injective: [
      bridge.approve({ params: p.injective, walletProvider: w.injective }),
      bridge.approve({ params: p.injective, raw: false, walletProvider: w.injective }),
      bridge.approve({ params: p.injective, raw: true }),
      bridge.approve(
        isRaw ? { params: p.injective, raw: true } : { params: p.injective, raw: false, walletProvider: w.injective },
      ),
    ],
    near: [
      bridge.approve({ params: p.near, walletProvider: w.near }),
      bridge.approve({ params: p.near, raw: false, walletProvider: w.near }),
      bridge.approve({ params: p.near, raw: true }),
      bridge.approve(isRaw ? { params: p.near, raw: true } : { params: p.near, raw: false, walletProvider: w.near }),
    ],
    stacks: [
      bridge.approve({ params: p.stacks, walletProvider: w.stacks }),
      bridge.approve({ params: p.stacks, raw: false, walletProvider: w.stacks }),
      bridge.approve({ params: p.stacks, raw: true }),
      bridge.approve(
        isRaw ? { params: p.stacks, raw: true } : { params: p.stacks, raw: false, walletProvider: w.stacks },
      ),
    ],
    bitcoin: [
      bridge.approve({ params: p.bitcoin, walletProvider: w.bitcoin }),
      bridge.approve({ params: p.bitcoin, raw: false, walletProvider: w.bitcoin }),
      bridge.approve({ params: p.bitcoin, raw: true }),
      bridge.approve(
        isRaw ? { params: p.bitcoin, raw: true } : { params: p.bitcoin, raw: false, walletProvider: w.bitcoin },
      ),
    ],
  }) as const;

const createBridgeIntentRows = () =>
  ({
    sonic: [
      bridge.createBridgeIntent({ params: p.sonic, walletProvider: w.evm }),
      bridge.createBridgeIntent({ params: p.sonic, raw: false, walletProvider: w.evm }),
      bridge.createBridgeIntent({ params: p.sonic, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.sonic, raw: true } : { params: p.sonic, raw: false, walletProvider: w.evm },
      ),
    ],
    bsc: [
      bridge.createBridgeIntent({ params: p.bsc, walletProvider: w.evm }),
      bridge.createBridgeIntent({ params: p.bsc, raw: false, walletProvider: w.evm }),
      bridge.createBridgeIntent({ params: p.bsc, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.bsc, raw: true } : { params: p.bsc, raw: false, walletProvider: w.evm },
      ),
    ],
    icon: [
      bridge.createBridgeIntent({ params: p.icon, walletProvider: w.icon }),
      bridge.createBridgeIntent({ params: p.icon, raw: false, walletProvider: w.icon }),
      bridge.createBridgeIntent({ params: p.icon, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.icon, raw: true } : { params: p.icon, raw: false, walletProvider: w.icon },
      ),
    ],
    sui: [
      bridge.createBridgeIntent({ params: p.sui, walletProvider: w.sui }),
      bridge.createBridgeIntent({ params: p.sui, raw: false, walletProvider: w.sui }),
      bridge.createBridgeIntent({ params: p.sui, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.sui, raw: true } : { params: p.sui, raw: false, walletProvider: w.sui },
      ),
    ],
    solana: [
      bridge.createBridgeIntent({ params: p.solana, walletProvider: w.solana }),
      bridge.createBridgeIntent({ params: p.solana, raw: false, walletProvider: w.solana }),
      bridge.createBridgeIntent({ params: p.solana, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.solana, raw: true } : { params: p.solana, raw: false, walletProvider: w.solana },
      ),
    ],
    stellar: [
      bridge.createBridgeIntent({ params: p.stellar, walletProvider: w.stellar }),
      bridge.createBridgeIntent({ params: p.stellar, raw: false, walletProvider: w.stellar }),
      bridge.createBridgeIntent({ params: p.stellar, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.stellar, raw: true } : { params: p.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    injective: [
      bridge.createBridgeIntent({ params: p.injective, walletProvider: w.injective }),
      bridge.createBridgeIntent({ params: p.injective, raw: false, walletProvider: w.injective }),
      bridge.createBridgeIntent({ params: p.injective, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.injective, raw: true } : { params: p.injective, raw: false, walletProvider: w.injective },
      ),
    ],
    near: [
      bridge.createBridgeIntent({ params: p.near, walletProvider: w.near }),
      bridge.createBridgeIntent({ params: p.near, raw: false, walletProvider: w.near }),
      bridge.createBridgeIntent({ params: p.near, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.near, raw: true } : { params: p.near, raw: false, walletProvider: w.near },
      ),
    ],
    stacks: [
      bridge.createBridgeIntent({ params: p.stacks, walletProvider: w.stacks }),
      bridge.createBridgeIntent({ params: p.stacks, raw: false, walletProvider: w.stacks }),
      bridge.createBridgeIntent({ params: p.stacks, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.stacks, raw: true } : { params: p.stacks, raw: false, walletProvider: w.stacks },
      ),
    ],
    bitcoin: [
      bridge.createBridgeIntent({ params: p.bitcoin, walletProvider: w.bitcoin }),
      bridge.createBridgeIntent({ params: p.bitcoin, raw: false, walletProvider: w.bitcoin }),
      bridge.createBridgeIntent({ params: p.bitcoin, raw: true }),
      bridge.createBridgeIntent(
        isRaw ? { params: p.bitcoin, raw: true } : { params: p.bitcoin, raw: false, walletProvider: w.bitcoin },
      ),
    ],
  }) as const;

const isAllowanceValidRows = () =>
  ({
    sonic: [
      bridge.isAllowanceValid({ params: p.sonic, walletProvider: w.evm }),
      bridge.isAllowanceValid({ params: p.sonic, raw: false, walletProvider: w.evm }),
      bridge.isAllowanceValid({ params: p.sonic, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.sonic, raw: true } : { params: p.sonic, raw: false, walletProvider: w.evm },
      ),
    ],
    bsc: [
      bridge.isAllowanceValid({ params: p.bsc, walletProvider: w.evm }),
      bridge.isAllowanceValid({ params: p.bsc, raw: false, walletProvider: w.evm }),
      bridge.isAllowanceValid({ params: p.bsc, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.bsc, raw: true } : { params: p.bsc, raw: false, walletProvider: w.evm },
      ),
    ],
    icon: [
      bridge.isAllowanceValid({ params: p.icon, walletProvider: w.icon }),
      bridge.isAllowanceValid({ params: p.icon, raw: false, walletProvider: w.icon }),
      bridge.isAllowanceValid({ params: p.icon, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.icon, raw: true } : { params: p.icon, raw: false, walletProvider: w.icon },
      ),
    ],
    sui: [
      bridge.isAllowanceValid({ params: p.sui, walletProvider: w.sui }),
      bridge.isAllowanceValid({ params: p.sui, raw: false, walletProvider: w.sui }),
      bridge.isAllowanceValid({ params: p.sui, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.sui, raw: true } : { params: p.sui, raw: false, walletProvider: w.sui },
      ),
    ],
    solana: [
      bridge.isAllowanceValid({ params: p.solana, walletProvider: w.solana }),
      bridge.isAllowanceValid({ params: p.solana, raw: false, walletProvider: w.solana }),
      bridge.isAllowanceValid({ params: p.solana, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.solana, raw: true } : { params: p.solana, raw: false, walletProvider: w.solana },
      ),
    ],
    stellar: [
      bridge.isAllowanceValid({ params: p.stellar, walletProvider: w.stellar }),
      bridge.isAllowanceValid({ params: p.stellar, raw: false, walletProvider: w.stellar }),
      bridge.isAllowanceValid({ params: p.stellar, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.stellar, raw: true } : { params: p.stellar, raw: false, walletProvider: w.stellar },
      ),
    ],
    injective: [
      bridge.isAllowanceValid({ params: p.injective, walletProvider: w.injective }),
      bridge.isAllowanceValid({ params: p.injective, raw: false, walletProvider: w.injective }),
      bridge.isAllowanceValid({ params: p.injective, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.injective, raw: true } : { params: p.injective, raw: false, walletProvider: w.injective },
      ),
    ],
    near: [
      bridge.isAllowanceValid({ params: p.near, walletProvider: w.near }),
      bridge.isAllowanceValid({ params: p.near, raw: false, walletProvider: w.near }),
      bridge.isAllowanceValid({ params: p.near, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.near, raw: true } : { params: p.near, raw: false, walletProvider: w.near },
      ),
    ],
    stacks: [
      bridge.isAllowanceValid({ params: p.stacks, walletProvider: w.stacks }),
      bridge.isAllowanceValid({ params: p.stacks, raw: false, walletProvider: w.stacks }),
      bridge.isAllowanceValid({ params: p.stacks, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.stacks, raw: true } : { params: p.stacks, raw: false, walletProvider: w.stacks },
      ),
    ],
    bitcoin: [
      bridge.isAllowanceValid({ params: p.bitcoin, walletProvider: w.bitcoin }),
      bridge.isAllowanceValid({ params: p.bitcoin, raw: false, walletProvider: w.bitcoin }),
      bridge.isAllowanceValid({ params: p.bitcoin, raw: true }),
      bridge.isAllowanceValid(
        isRaw ? { params: p.bitcoin, raw: true } : { params: p.bitcoin, raw: false, walletProvider: w.bitcoin },
      ),
    ],
  }) as const;

// `buildApproveTxs` is raw-only and returns the chain's unsigned approval transactions.
const buildApproveTxsRows = () =>
  ({
    sonic: bridge.buildApproveTxs({ params: p.sonic, raw: true }),
    bsc: bridge.buildApproveTxs({ params: p.bsc, raw: true }),
    icon: bridge.buildApproveTxs({ params: p.icon, raw: true }),
    sui: bridge.buildApproveTxs({ params: p.sui, raw: true }),
    solana: bridge.buildApproveTxs({ params: p.solana, raw: true }),
    stellar: bridge.buildApproveTxs({ params: p.stellar, raw: true }),
    injective: bridge.buildApproveTxs({ params: p.injective, raw: true }),
    near: bridge.buildApproveTxs({ params: p.near, raw: true }),
    stacks: bridge.buildApproveTxs({ params: p.stacks, raw: true }),
    bitcoin: bridge.buildApproveTxs({ params: p.bitcoin, raw: true }),
  }) as const;

describe('BridgeService — chain- and mode-generic actions', () => {
  it('approve: hash per family when signed, unsigned tx with raw: true, both for a runtime boolean', () => {
    expectTypeOf<Settled<ReturnType<typeof approveRows>>>().toEqualTypeOf<{
      [F in keyof Family]: Modes<Family[F][0], Family[F][1], BridgeApproveError>;
    }>();
  });

  it('createBridgeIntent: the spoke tx per family and mode, with its relay data', () => {
    expectTypeOf<Settled<ReturnType<typeof createBridgeIntentRows>>>().toEqualTypeOf<{
      [F in keyof Family]: [
        Result<Intented<Family[F][0]>, BridgeCreateIntentError>,
        Result<Intented<Family[F][0]>, BridgeCreateIntentError>,
        Result<Intented<Family[F][1]>, BridgeCreateIntentError>,
        Result<Intented<Family[F][0] | Family[F][1]>, BridgeCreateIntentError>,
      ];
    }>();
  });

  it('isAllowanceValid: a boolean in every family and mode', () => {
    type B = Result<boolean, BridgeAllowanceCheckError>;
    expectTypeOf<Settled<ReturnType<typeof isAllowanceValidRows>>>().toEqualTypeOf<{
      [F in keyof Family]: [B, B, B, B];
    }>();
  });

  it('buildApproveTxs: the chain’s unsigned reset/approve pair', () => {
    expectTypeOf<Unwrapped<ReturnType<typeof buildApproveTxsRows>>>().toEqualTypeOf<{
      [F in keyof Family]: Result<
        { readonly resetTx?: Family[F][1]; readonly approveTx: Family[F][1] },
        BridgeApproveError
      >;
    }>();
  });

  it('signed-only orchestrations resolve to the same result whatever the chain', () => {
    const bridges = () =>
      [
        bridge.bridge({ params: p.bsc, walletProvider: w.evm }),
        bridge.bridge({ params: p.stellar, raw: false, walletProvider: w.stellar }),
        bridge.bridge({ params: p.bitcoin, walletProvider: w.bitcoin }),
      ] as const;
    type Pair = Result<TxHashPair, BridgeOrchestrationError>;
    expectTypeOf<AwaitAll<ReturnType<typeof bridges>>>().toEqualTypeOf<[Pair, Pair, Pair]>();

    const withApproval = () =>
      [
        bridge.bridgeWithApproval({ params: p.bsc, walletProvider: w.evm }),
        bridge.bridgeWithApproval({ params: p.sui, walletProvider: w.sui, resumeBatchId: 'id' }),
      ] as const;
    type WithApproval = Result<TxHashPair & { approvalStrategy: ApprovalStrategy }, BridgeWithApprovalError>;
    expectTypeOf<AwaitAll<ReturnType<typeof withApproval>>>().toEqualTypeOf<[WithApproval, WithApproval]>();

    const strategy = () =>
      [
        bridge.getApprovalStrategy({ params: p.sonic, walletProvider: w.evm }),
        bridge.getApprovalStrategy({ params: p.near, walletProvider: w.near }),
      ] as const;
    type Strategy = Result<ApprovalStrategy, BridgeAllowanceCheckError>;
    expectTypeOf<AwaitAll<ReturnType<typeof strategy>>>().toEqualTypeOf<[Strategy, Strategy]>();
  });

  it('rejects invalid chain / wallet / mode combinations', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids a walletProvider.
      bridge.approve({ params: p.bsc, raw: true, walletProvider: w.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      bridge.createBridgeIntent({ params: p.bsc }),
      // @ts-expect-error — the walletProvider must match the source chain family.
      bridge.createBridgeIntent({ params: p.solana, walletProvider: w.evm }),
      // @ts-expect-error — bridge is signed-only.
      bridge.bridge({ params: p.bsc, raw: true }),
      // @ts-expect-error — bridgeWithApproval is signed-only.
      bridge.bridgeWithApproval({ params: p.bsc, raw: true }),
      // @ts-expect-error — buildApproveTxs is raw-only.
      bridge.buildApproveTxs({ params: p.bsc, walletProvider: w.evm }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});

describe('BridgeService — non-narrowing methods', () => {
  it('pins each result type', () => {
    expectTypeOf<ReturnType<BridgeService['getFee']>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<BridgeService['buildBridgeData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<BridgeService['getDetailedStatus']>>().toEqualTypeOf<
      Promise<Result<DetailedBridgeStatus, BridgeDetailedStatusError>>
    >();
    expectTypeOf<ReturnType<BridgeService['getBridgeableAmount']>>().toEqualTypeOf<
      Promise<Result<BridgeLimit, BridgeLookupError>>
    >();
    expectTypeOf<ReturnType<BridgeService['isBridgeable']>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<BridgeService['getBridgeableTokens']>>().toEqualTypeOf<
      Result<XToken[], BridgeLookupError>
    >();
    expectTypeOf<ReturnType<BridgeService['filterTokensWithSameVault']>>().toEqualTypeOf<XToken[]>();
    expectTypeOf<ReturnType<BridgeService['findTokenBalanceInReserves']>>().toEqualTypeOf<bigint>();
  });
});
