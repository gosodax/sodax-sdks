/**
 * Compile-time contract: ClService liquidity actions type their result by the source chain family and
 * execution mode; signed orchestrations resolve to a `TxHashPair`; hub reads and the static math
 * helpers return fixed types. Errors are the untyped `Result` default (`unknown`), pinned as such.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BitcoinRawTransaction,
  ChainKeys,
  ClClaimRewardsParams,
  ClDecreaseLiquidityParams,
  ClIncreaseLiquidityParams,
  ClLiquidityClaimRewardsAction,
  ClLiquidityDecreaseLiquidityAction,
  ClLiquidityIncreaseLiquidityAction,
  ClMintPositionEventLog,
  ClPositionInfo,
  ClSupplyAction,
  ClSupplyParams,
  EvmContractCall,
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
  PoolData,
  PoolKey,
  PoolRewardConfig,
  PoolSpokeAssets,
  RelayExtraData,
  Result,
  SolanaRawTransaction,
  StacksRawTransaction,
  StellarRawTransaction,
  SuiRawTransaction,
  TxHashPair,
} from '../index.js';
import type { ClService } from './ConcentratedLiquidityService.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type Keys = {
  evm: BSC;
  hub: typeof ChainKeys.SONIC_MAINNET;
  icon: typeof ChainKeys.ICON_MAINNET;
  sui: typeof ChainKeys.SUI_MAINNET;
  stellar: typeof ChainKeys.STELLAR_MAINNET;
  solana: typeof ChainKeys.SOLANA_MAINNET;
  injective: typeof ChainKeys.INJECTIVE_MAINNET;
  near: typeof ChainKeys.NEAR_MAINNET;
  stacks: typeof ChainKeys.STACKS_MAINNET;
  bitcoin: typeof ChainKeys.BITCOIN_MAINNET;
};
// [signed, raw] result per family, spelled out rather than derived through `TxReturnType`.
type Fam = {
  evm: [Hex, EvmRawTransaction];
  hub: [Hex, EvmRawTransaction];
  icon: [Hex, IconRawTransaction];
  sui: [string, SuiRawTransaction];
  stellar: [string, StellarRawTransaction];
  solana: [string, SolanaRawTransaction];
  injective: [string, InjectiveRawTransaction];
  near: [string, NearRawTransaction];
  stacks: [string, StacksRawTransaction];
  // Bitcoin's raw type already includes the hash string.
  bitcoin: [string, BitcoinRawTransaction | string];
};
// Known gap against ADR 0001: declared as plain Result<T>, so the error is unknown.
type Intent<T> = Promise<Result<{ tx: T; relayData: RelayExtraData }, unknown>>;
type IntentMatrix = { readonly [N in keyof Fam]: readonly [Intent<Fam[N][0]>, Intent<Fam[N][1]>] };
type Pair = Promise<Result<TxHashPair, unknown>>;

declare const svc: ClService;
declare const wallet: {
  evm: IEvmWalletProvider;
  hub: IEvmWalletProvider;
  icon: IIconWalletProvider;
  sui: ISuiWalletProvider;
  stellar: IStellarWalletProvider;
  solana: ISolanaWalletProvider;
  injective: IInjectiveWalletProvider;
  near: INearWalletProvider;
  stacks: IStacksWalletProvider;
  bitcoin: IBitcoinWalletProvider;
};
declare const supply: { [N in keyof Keys]: ClSupplyParams<Keys[N]> };
declare const increase: { [N in keyof Keys]: ClIncreaseLiquidityParams<Keys[N]> };
declare const decrease: { [N in keyof Keys]: ClDecreaseLiquidityParams<Keys[N]> };
declare const claim: { [N in keyof Keys]: ClClaimRewardsParams<Keys[N]> };
declare const isRaw: boolean;

// One row per chain family: [walletProvider, raw: true]. Never invoked.
const supplyRows = () =>
  ({
    evm: [
      svc.executeSupplyLiquidity({ params: supply.evm, walletProvider: wallet.evm }),
      svc.executeSupplyLiquidity({ params: supply.evm, raw: true }),
    ],
    hub: [
      svc.executeSupplyLiquidity({ params: supply.hub, walletProvider: wallet.hub }),
      svc.executeSupplyLiquidity({ params: supply.hub, raw: true }),
    ],
    icon: [
      svc.executeSupplyLiquidity({ params: supply.icon, walletProvider: wallet.icon }),
      svc.executeSupplyLiquidity({ params: supply.icon, raw: true }),
    ],
    sui: [
      svc.executeSupplyLiquidity({ params: supply.sui, walletProvider: wallet.sui }),
      svc.executeSupplyLiquidity({ params: supply.sui, raw: true }),
    ],
    stellar: [
      svc.executeSupplyLiquidity({ params: supply.stellar, walletProvider: wallet.stellar }),
      svc.executeSupplyLiquidity({ params: supply.stellar, raw: true }),
    ],
    solana: [
      svc.executeSupplyLiquidity({ params: supply.solana, walletProvider: wallet.solana }),
      svc.executeSupplyLiquidity({ params: supply.solana, raw: true }),
    ],
    injective: [
      svc.executeSupplyLiquidity({ params: supply.injective, walletProvider: wallet.injective }),
      svc.executeSupplyLiquidity({ params: supply.injective, raw: true }),
    ],
    near: [
      svc.executeSupplyLiquidity({ params: supply.near, walletProvider: wallet.near }),
      svc.executeSupplyLiquidity({ params: supply.near, raw: true }),
    ],
    stacks: [
      svc.executeSupplyLiquidity({ params: supply.stacks, walletProvider: wallet.stacks }),
      svc.executeSupplyLiquidity({ params: supply.stacks, raw: true }),
    ],
    bitcoin: [
      svc.executeSupplyLiquidity({ params: supply.bitcoin, walletProvider: wallet.bitcoin }),
      svc.executeSupplyLiquidity({ params: supply.bitcoin, raw: true }),
    ],
  }) as const;
const increaseRows = () =>
  ({
    evm: [
      svc.executeIncreaseLiquidity({ params: increase.evm, walletProvider: wallet.evm }),
      svc.executeIncreaseLiquidity({ params: increase.evm, raw: true }),
    ],
    hub: [
      svc.executeIncreaseLiquidity({ params: increase.hub, walletProvider: wallet.hub }),
      svc.executeIncreaseLiquidity({ params: increase.hub, raw: true }),
    ],
    icon: [
      svc.executeIncreaseLiquidity({ params: increase.icon, walletProvider: wallet.icon }),
      svc.executeIncreaseLiquidity({ params: increase.icon, raw: true }),
    ],
    sui: [
      svc.executeIncreaseLiquidity({ params: increase.sui, walletProvider: wallet.sui }),
      svc.executeIncreaseLiquidity({ params: increase.sui, raw: true }),
    ],
    stellar: [
      svc.executeIncreaseLiquidity({ params: increase.stellar, walletProvider: wallet.stellar }),
      svc.executeIncreaseLiquidity({ params: increase.stellar, raw: true }),
    ],
    solana: [
      svc.executeIncreaseLiquidity({ params: increase.solana, walletProvider: wallet.solana }),
      svc.executeIncreaseLiquidity({ params: increase.solana, raw: true }),
    ],
    injective: [
      svc.executeIncreaseLiquidity({ params: increase.injective, walletProvider: wallet.injective }),
      svc.executeIncreaseLiquidity({ params: increase.injective, raw: true }),
    ],
    near: [
      svc.executeIncreaseLiquidity({ params: increase.near, walletProvider: wallet.near }),
      svc.executeIncreaseLiquidity({ params: increase.near, raw: true }),
    ],
    stacks: [
      svc.executeIncreaseLiquidity({ params: increase.stacks, walletProvider: wallet.stacks }),
      svc.executeIncreaseLiquidity({ params: increase.stacks, raw: true }),
    ],
    bitcoin: [
      svc.executeIncreaseLiquidity({ params: increase.bitcoin, walletProvider: wallet.bitcoin }),
      svc.executeIncreaseLiquidity({ params: increase.bitcoin, raw: true }),
    ],
  }) as const;
const decreaseRows = () =>
  ({
    evm: [
      svc.executeDecreaseLiquidity({ params: decrease.evm, walletProvider: wallet.evm }),
      svc.executeDecreaseLiquidity({ params: decrease.evm, raw: true }),
    ],
    hub: [
      svc.executeDecreaseLiquidity({ params: decrease.hub, walletProvider: wallet.hub }),
      svc.executeDecreaseLiquidity({ params: decrease.hub, raw: true }),
    ],
    icon: [
      svc.executeDecreaseLiquidity({ params: decrease.icon, walletProvider: wallet.icon }),
      svc.executeDecreaseLiquidity({ params: decrease.icon, raw: true }),
    ],
    sui: [
      svc.executeDecreaseLiquidity({ params: decrease.sui, walletProvider: wallet.sui }),
      svc.executeDecreaseLiquidity({ params: decrease.sui, raw: true }),
    ],
    stellar: [
      svc.executeDecreaseLiquidity({ params: decrease.stellar, walletProvider: wallet.stellar }),
      svc.executeDecreaseLiquidity({ params: decrease.stellar, raw: true }),
    ],
    solana: [
      svc.executeDecreaseLiquidity({ params: decrease.solana, walletProvider: wallet.solana }),
      svc.executeDecreaseLiquidity({ params: decrease.solana, raw: true }),
    ],
    injective: [
      svc.executeDecreaseLiquidity({ params: decrease.injective, walletProvider: wallet.injective }),
      svc.executeDecreaseLiquidity({ params: decrease.injective, raw: true }),
    ],
    near: [
      svc.executeDecreaseLiquidity({ params: decrease.near, walletProvider: wallet.near }),
      svc.executeDecreaseLiquidity({ params: decrease.near, raw: true }),
    ],
    stacks: [
      svc.executeDecreaseLiquidity({ params: decrease.stacks, walletProvider: wallet.stacks }),
      svc.executeDecreaseLiquidity({ params: decrease.stacks, raw: true }),
    ],
    bitcoin: [
      svc.executeDecreaseLiquidity({ params: decrease.bitcoin, walletProvider: wallet.bitcoin }),
      svc.executeDecreaseLiquidity({ params: decrease.bitcoin, raw: true }),
    ],
  }) as const;
const claimRows = () =>
  ({
    evm: [
      svc.executeClaimRewards({ params: claim.evm, walletProvider: wallet.evm }),
      svc.executeClaimRewards({ params: claim.evm, raw: true }),
    ],
    hub: [
      svc.executeClaimRewards({ params: claim.hub, walletProvider: wallet.hub }),
      svc.executeClaimRewards({ params: claim.hub, raw: true }),
    ],
    icon: [
      svc.executeClaimRewards({ params: claim.icon, walletProvider: wallet.icon }),
      svc.executeClaimRewards({ params: claim.icon, raw: true }),
    ],
    sui: [
      svc.executeClaimRewards({ params: claim.sui, walletProvider: wallet.sui }),
      svc.executeClaimRewards({ params: claim.sui, raw: true }),
    ],
    stellar: [
      svc.executeClaimRewards({ params: claim.stellar, walletProvider: wallet.stellar }),
      svc.executeClaimRewards({ params: claim.stellar, raw: true }),
    ],
    solana: [
      svc.executeClaimRewards({ params: claim.solana, walletProvider: wallet.solana }),
      svc.executeClaimRewards({ params: claim.solana, raw: true }),
    ],
    injective: [
      svc.executeClaimRewards({ params: claim.injective, walletProvider: wallet.injective }),
      svc.executeClaimRewards({ params: claim.injective, raw: true }),
    ],
    near: [
      svc.executeClaimRewards({ params: claim.near, walletProvider: wallet.near }),
      svc.executeClaimRewards({ params: claim.near, raw: true }),
    ],
    stacks: [
      svc.executeClaimRewards({ params: claim.stacks, walletProvider: wallet.stacks }),
      svc.executeClaimRewards({ params: claim.stacks, raw: true }),
    ],
    bitcoin: [
      svc.executeClaimRewards({ params: claim.bitcoin, walletProvider: wallet.bitcoin }),
      svc.executeClaimRewards({ params: claim.bitcoin, raw: true }),
    ],
  }) as const;

describe('ClService', () => {
  it('executeSupplyLiquidity narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof supplyRows>>().toEqualTypeOf<IntentMatrix>();
  });

  it('executeIncreaseLiquidity narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof increaseRows>>().toEqualTypeOf<IntentMatrix>();
  });

  it('executeDecreaseLiquidity narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof decreaseRows>>().toEqualTypeOf<IntentMatrix>();
  });

  it('executeClaimRewards narrows to the source chain family and mode', () => {
    expectTypeOf<ReturnType<typeof claimRows>>().toEqualTypeOf<IntentMatrix>();
  });

  it('explicit raw: false matches the omitted form; a runtime mode keeps both results', () => {
    const explicit = () => svc.executeSupplyLiquidity({ params: supply.icon, raw: false, walletProvider: wallet.icon });
    expectTypeOf<ReturnType<typeof explicit>>().toEqualTypeOf<Intent<Hex>>();
    type Both = Intent<Hex | EvmRawTransaction>;
    const s = (args: ClSupplyAction<BSC, boolean>) => svc.executeSupplyLiquidity(args);
    const i = (args: ClLiquidityIncreaseLiquidityAction<BSC, boolean>) => svc.executeIncreaseLiquidity(args);
    const d = (args: ClLiquidityDecreaseLiquidityAction<BSC, boolean>) => svc.executeDecreaseLiquidity(args);
    const c = (args: ClLiquidityClaimRewardsAction<BSC, boolean>) => svc.executeClaimRewards(args);
    expectTypeOf<ReturnType<typeof s>>().toEqualTypeOf<Both>();
    expectTypeOf<ReturnType<typeof i>>().toEqualTypeOf<Both>();
    expectTypeOf<ReturnType<typeof d>>().toEqualTypeOf<Both>();
    expectTypeOf<ReturnType<typeof c>>().toEqualTypeOf<Both>();
  });

  it('signed orchestrations resolve to a TxHashPair in every family', () => {
    const calls = () =>
      [
        svc.supplyLiquidity({ params: supply.evm, walletProvider: wallet.evm }),
        svc.supplyLiquidity({ params: supply.hub, walletProvider: wallet.hub }),
        svc.increaseLiquidity({ params: increase.sui, walletProvider: wallet.sui }),
        svc.decreaseLiquidity({ params: decrease.stellar, walletProvider: wallet.stellar }),
        svc.claimRewards({ params: claim.icon, walletProvider: wallet.icon }),
        svc.claimRewards({ params: claim.solana, walletProvider: wallet.solana }),
      ] as const;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [Pair, Pair, Pair, Pair, Pair, Pair]>();
  });

  it('hub reads and builders return their fixed types', () => {
    expectTypeOf<ReturnType<ClService['getAssetsForPool']>>().toEqualTypeOf<PoolSpokeAssets>();
    expectTypeOf<ReturnType<ClService['getMintPositionEvent']>>().toEqualTypeOf<
      Promise<Result<ClMintPositionEventLog, unknown>>
    >();
    expectTypeOf<ReturnType<ClService['permit2Approve']>>().toEqualTypeOf<EvmContractCall[]>();
    expectTypeOf<ReturnType<ClService['getPoolRewardConfig']>>().toEqualTypeOf<
      Promise<Result<PoolRewardConfig, unknown>>
    >();
    expectTypeOf<ReturnType<ClService['getPools']>>().toEqualTypeOf<PoolKey[]>();
    expectTypeOf<ReturnType<ClService['getPoolData']>>().toEqualTypeOf<Promise<Result<PoolData, unknown>>>();
    expectTypeOf<ReturnType<ClService['getPositionInfo']>>().toEqualTypeOf<Promise<Result<ClPositionInfo, unknown>>>();
  });

  it('static liquidity math returns bigints', () => {
    expectTypeOf<ReturnType<typeof ClService.calculateLiquidityFromAmounts>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof ClService.calculateAmount1FromAmount0>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof ClService.calculateAmount0FromAmount1>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<typeof ClService.calculateMaxAmountsForSlippage>>().toEqualTypeOf<{
      amount0Max: bigint;
      amount1Max: bigint;
    }>();
    expectTypeOf<ReturnType<typeof ClService.priceToTick>>().toEqualTypeOf<bigint>();
  });

  it('rejects wrong wallets and modes', () => {
    const calls = () => [
      // @ts-expect-error — the walletProvider must match the source chain.
      svc.executeSupplyLiquidity({ params: supply.evm, walletProvider: wallet.sui }),
      // @ts-expect-error — the walletProvider must match the source chain.
      svc.executeClaimRewards({ params: claim.stellar, walletProvider: wallet.evm }),
      // @ts-expect-error — raw: true forbids walletProvider.
      svc.executeIncreaseLiquidity({ params: increase.evm, raw: true, walletProvider: wallet.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      svc.executeDecreaseLiquidity({ params: decrease.evm }),
      // @ts-expect-error — the orchestrated supply is signed only.
      svc.supplyLiquidity({ params: supply.evm, raw: true }),
      // @ts-expect-error — a non-literal boolean cannot pick a branch in an object literal.
      svc.executeClaimRewards({ params: claim.evm, raw: isRaw }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
