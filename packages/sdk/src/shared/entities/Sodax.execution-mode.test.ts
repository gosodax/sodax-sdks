/**
 * Compile-time contract: every action that supports both execution modes types its result by the
 * mode the caller picks, with no type arguments. `{ walletProvider }` (or `raw: false`) resolves to
 * the chain's broadcast hash, `{ raw: true }` to its unsigned transaction. These assertions only
 * bite through `pnpm checkTs` (tsc over src, test files included); at runtime they are no-ops.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  AssetDepositAction,
  AssetWithdrawAction,
  BalnMigrateAction,
  BitcoinRawTransaction,
  BridgeParams,
  CancelIntentActionParams,
  CancelUnstakeAction,
  ChainKeys,
  ClaimAction,
  ClLiquidityClaimRewardsAction,
  ClLiquidityDecreaseLiquidityAction,
  ClLiquidityIncreaseLiquidityAction,
  ClSupplyAction,
  CreateIntentParams,
  EvmRawTransaction,
  FeeTokenApproveAction,
  Hex,
  IBitcoinWalletProvider,
  IcxMigrateAction,
  IcxRevertMigrationAction,
  IconRawTransaction,
  IEvmWalletProvider,
  IIconWalletProvider,
  IInjectiveWalletProvider,
  INearWalletProvider,
  InjectiveRawTransaction,
  InstantUnstakeAction,
  ISolanaWalletProvider,
  IStacksWalletProvider,
  IStellarWalletProvider,
  ISuiWalletProvider,
  LimitOrderActionParams,
  MoneyMarketApproveActionParams,
  MoneyMarketBorrowActionParams,
  MoneyMarketRepayActionParams,
  MoneyMarketSupplyActionParams,
  MoneyMarketWithdrawActionParams,
  NearRawTransaction,
  PartnerFeeClaimCancelAction,
  PartnerFeeClaimSwapAction,
  SendMessageParams,
  Sodax,
  SolanaRawTransaction,
  SpokeApproveParams,
  StacksRawTransaction,
  StakeAction,
  StakingParamsUnion,
  StellarRawTransaction,
  SuiRawTransaction,
  SwapActionParams,
  UnifiedBnUSDMigrateAction,
  UnstakeAction,
  VaultSwapActionParams,
  WithdrawHubAssetAction,
} from '../../index.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SONIC = typeof ChainKeys.SONIC_MAINNET;
type ICON = typeof ChainKeys.ICON_MAINNET;

// Success value of a `Promise<Result<…>>`; the spoke transaction when the value is an intent result.
type Ok<P> = Extract<Awaited<P>, { ok: true }> extends { value: infer V } ? V : never;
type Tx<P> = Ok<P> extends { tx: infer T; relayData: unknown } ? T : Ok<P>;
type ParamsOf<A> = A extends { params: infer P } ? P : never;
type Flat<A> = Omit<A, 'raw' | 'walletProvider'>;
type Rows = Record<string, readonly [signed: unknown, raw: unknown]>;
// Strict identity: `any`, `never` and a wider union never match the expected type.
type Same<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
// The rows whose signed or raw result differs from `E`, so a failure names the method and its actual types.
type Mismatches<T extends Rows, E extends { [M in keyof T]: readonly [unknown, unknown] }> = {
  [M in keyof T as Same<Tx<T[M][0]>, E[M][0]> extends true
    ? Same<Tx<T[M][1]>, E[M][1]> extends true
      ? never
      : M
    : M]: { signed: Tx<T[M][0]>; raw: Tx<T[M][1]> };
};
type Uniform<T, Signed, Raw> = { [M in keyof T]: readonly [Signed, Raw] };
type None = Record<never, never>;

declare const sodax: Sodax;
declare const evm: IEvmWalletProvider;
declare const iconWallet: IIconWalletProvider;
declare const isRaw: boolean;

declare const swapP: ParamsOf<SwapActionParams<BSC>>;
declare const limitP: ParamsOf<LimitOrderActionParams<BSC>>;
declare const cancelP: ParamsOf<CancelIntentActionParams<BSC>>;
declare const bridgeP: ParamsOf<BridgeParams<BSC, false>>;
declare const mmApproveP: ParamsOf<MoneyMarketApproveActionParams<BSC>>;
declare const supplyP: ParamsOf<MoneyMarketSupplyActionParams<BSC>>;
declare const borrowP: ParamsOf<MoneyMarketBorrowActionParams<BSC>>;
declare const withdrawP: ParamsOf<MoneyMarketWithdrawActionParams<BSC>>;
declare const repayP: ParamsOf<MoneyMarketRepayActionParams<BSC>>;
declare const stakingP: ParamsOf<StakingParamsUnion<BSC, false>>;
declare const stakeP: ParamsOf<StakeAction<BSC, false>>;
declare const unstakeP: ParamsOf<UnstakeAction<BSC, false>>;
declare const instantP: ParamsOf<InstantUnstakeAction<BSC, false>>;
declare const claimP: ParamsOf<ClaimAction<BSC, false>>;
declare const cancelUnstakeP: ParamsOf<CancelUnstakeAction<BSC, false>>;
declare const bnUsdP: ParamsOf<UnifiedBnUSDMigrateAction<BSC, false>>;
declare const assetDepositP: ParamsOf<AssetDepositAction<BSC, false>>;
declare const assetWithdrawP: ParamsOf<AssetWithdrawAction<BSC, false>>;
declare const clSupplyP: ParamsOf<ClSupplyAction<BSC, false>>;
declare const clIncreaseP: ParamsOf<ClLiquidityIncreaseLiquidityAction<BSC, false>>;
declare const clDecreaseP: ParamsOf<ClLiquidityDecreaseLiquidityAction<BSC, false>>;
declare const clClaimP: ParamsOf<ClLiquidityClaimRewardsAction<BSC, false>>;
declare const recoveryP: ParamsOf<WithdrawHubAssetAction<BSC, false>>;
declare const vaultP: ParamsOf<VaultSwapActionParams<BSC>>;
declare const spokeApproveP: Flat<SpokeApproveParams<BSC, false>>;
declare const sendMessageP: Flat<SendMessageParams<BSC, false>>;
declare const feeApproveP: ParamsOf<FeeTokenApproveAction<SONIC, false>>;
declare const autoSwapP: ParamsOf<PartnerFeeClaimSwapAction<SONIC, false>>;
declare const feeCancelP: ParamsOf<PartnerFeeClaimCancelAction<SONIC, false>>;
declare const revertP: ParamsOf<IcxRevertMigrationAction<false>>;
declare const balnP: ParamsOf<BalnMigrateAction<false>>;
declare const icxP: ParamsOf<IcxMigrateAction<false>>;

// One row per action: [call with walletProvider and no `raw`, call with `raw: true`]. Never invoked.
const evmRows = () =>
  ({
    'swaps.approve': [
      sodax.swaps.approve({ params: swapP, walletProvider: evm }),
      sodax.swaps.approve({ params: swapP, raw: true }),
    ],
    'swaps.createIntent': [
      sodax.swaps.createIntent({ params: swapP, walletProvider: evm }),
      sodax.swaps.createIntent({ params: swapP, raw: true }),
    ],
    'swaps.createLimitOrderIntent': [
      sodax.swaps.createLimitOrderIntent({ params: limitP, walletProvider: evm }),
      sodax.swaps.createLimitOrderIntent({ params: limitP, raw: true }),
    ],
    'swaps.createCancelIntent': [
      sodax.swaps.createCancelIntent({ params: cancelP, walletProvider: evm }),
      sodax.swaps.createCancelIntent({ params: cancelP, raw: true }),
    ],
    'bridge.approve': [
      sodax.bridge.approve({ params: bridgeP, walletProvider: evm }),
      sodax.bridge.approve({ params: bridgeP, raw: true }),
    ],
    'bridge.createBridgeIntent': [
      sodax.bridge.createBridgeIntent({ params: bridgeP, walletProvider: evm }),
      sodax.bridge.createBridgeIntent({ params: bridgeP, raw: true }),
    ],
    'moneyMarket.approve': [
      sodax.moneyMarket.approve({ params: mmApproveP, walletProvider: evm }),
      sodax.moneyMarket.approve({ params: mmApproveP, raw: true }),
    ],
    'moneyMarket.createSupplyIntent': [
      sodax.moneyMarket.createSupplyIntent({ params: supplyP, walletProvider: evm }),
      sodax.moneyMarket.createSupplyIntent({ params: supplyP, raw: true }),
    ],
    'moneyMarket.createBorrowIntent': [
      sodax.moneyMarket.createBorrowIntent({ params: borrowP, walletProvider: evm }),
      sodax.moneyMarket.createBorrowIntent({ params: borrowP, raw: true }),
    ],
    'moneyMarket.createWithdrawIntent': [
      sodax.moneyMarket.createWithdrawIntent({ params: withdrawP, walletProvider: evm }),
      sodax.moneyMarket.createWithdrawIntent({ params: withdrawP, raw: true }),
    ],
    'moneyMarket.createRepayIntent': [
      sodax.moneyMarket.createRepayIntent({ params: repayP, walletProvider: evm }),
      sodax.moneyMarket.createRepayIntent({ params: repayP, raw: true }),
    ],
    'staking.approve': [
      sodax.staking.approve({ params: stakingP, walletProvider: evm }),
      sodax.staking.approve({ params: stakingP, raw: true }),
    ],
    'staking.createStakeIntent': [
      sodax.staking.createStakeIntent({ params: stakeP, walletProvider: evm }),
      sodax.staking.createStakeIntent({ params: stakeP, raw: true }),
    ],
    'staking.createUnstakeIntent': [
      sodax.staking.createUnstakeIntent({ params: unstakeP, walletProvider: evm }),
      sodax.staking.createUnstakeIntent({ params: unstakeP, raw: true }),
    ],
    'staking.createInstantUnstakeIntent': [
      sodax.staking.createInstantUnstakeIntent({ params: instantP, walletProvider: evm }),
      sodax.staking.createInstantUnstakeIntent({ params: instantP, raw: true }),
    ],
    'staking.createClaimIntent': [
      sodax.staking.createClaimIntent({ params: claimP, walletProvider: evm }),
      sodax.staking.createClaimIntent({ params: claimP, raw: true }),
    ],
    'staking.createCancelUnstakeIntent': [
      sodax.staking.createCancelUnstakeIntent({ params: cancelUnstakeP, walletProvider: evm }),
      sodax.staking.createCancelUnstakeIntent({ params: cancelUnstakeP, raw: true }),
    ],
    'migration.approve': [
      sodax.migration.approve({ params: bnUsdP, walletProvider: evm }, 'migrate'),
      sodax.migration.approve({ params: bnUsdP, raw: true }, 'migrate'),
    ],
    'migration.createMigratebnUSDIntent': [
      sodax.migration.createMigratebnUSDIntent({ params: bnUsdP, walletProvider: evm }),
      sodax.migration.createMigratebnUSDIntent({ params: bnUsdP, raw: true }),
    ],
    'dex.assetService.approve': [
      sodax.dex.assetService.approve({ params: assetDepositP, walletProvider: evm }),
      sodax.dex.assetService.approve({ params: assetDepositP, raw: true }),
    ],
    'dex.assetService.executeDeposit': [
      sodax.dex.assetService.executeDeposit({ params: assetDepositP, walletProvider: evm }),
      sodax.dex.assetService.executeDeposit({ params: assetDepositP, raw: true }),
    ],
    'dex.assetService.executeWithdraw': [
      sodax.dex.assetService.executeWithdraw({ params: assetWithdrawP, walletProvider: evm }),
      sodax.dex.assetService.executeWithdraw({ params: assetWithdrawP, raw: true }),
    ],
    'dex.clService.executeSupplyLiquidity': [
      sodax.dex.clService.executeSupplyLiquidity({ params: clSupplyP, walletProvider: evm }),
      sodax.dex.clService.executeSupplyLiquidity({ params: clSupplyP, raw: true }),
    ],
    'dex.clService.executeIncreaseLiquidity': [
      sodax.dex.clService.executeIncreaseLiquidity({ params: clIncreaseP, walletProvider: evm }),
      sodax.dex.clService.executeIncreaseLiquidity({ params: clIncreaseP, raw: true }),
    ],
    'dex.clService.executeDecreaseLiquidity': [
      sodax.dex.clService.executeDecreaseLiquidity({ params: clDecreaseP, walletProvider: evm }),
      sodax.dex.clService.executeDecreaseLiquidity({ params: clDecreaseP, raw: true }),
    ],
    'dex.clService.executeClaimRewards': [
      sodax.dex.clService.executeClaimRewards({ params: clClaimP, walletProvider: evm }),
      sodax.dex.clService.executeClaimRewards({ params: clClaimP, raw: true }),
    ],
    'recovery.withdrawHubAsset': [
      sodax.recovery.withdrawHubAsset({ params: recoveryP, walletProvider: evm }),
      sodax.recovery.withdrawHubAsset({ params: recoveryP, raw: true }),
    ],
    'leverageYield.createVaultIntent': [
      sodax.leverageYield.createVaultIntent({ params: vaultP, walletProvider: evm }),
      sodax.leverageYield.createVaultIntent({ params: vaultP, raw: true }),
    ],
    'spoke.approve': [
      sodax.spoke.approve({ ...spokeApproveP, walletProvider: evm }),
      sodax.spoke.approve({ ...spokeApproveP, raw: true }),
    ],
    'spoke.sendMessage': [
      sodax.spoke.sendMessage({ ...sendMessageP, walletProvider: evm }),
      sodax.spoke.sendMessage({ ...sendMessageP, raw: true }),
    ],
    // Hub-only actions: the chain is fixed to Sonic, so these run with the EVM types too.
    'partners.feeClaim.approveToken': [
      sodax.partners.feeClaim.approveToken({ params: feeApproveP, walletProvider: evm }),
      sodax.partners.feeClaim.approveToken({ params: feeApproveP, raw: true }),
    ],
    'partners.feeClaim.createIntentAutoSwap': [
      sodax.partners.feeClaim.createIntentAutoSwap({ params: autoSwapP, walletProvider: evm }),
      sodax.partners.feeClaim.createIntentAutoSwap({ params: autoSwapP, raw: true }),
    ],
    'partners.feeClaim.cancelIntent': [
      sodax.partners.feeClaim.cancelIntent({ params: feeCancelP, walletProvider: evm }),
      sodax.partners.feeClaim.cancelIntent({ params: feeCancelP, raw: true }),
    ],
    'migration.createRevertSodaToIcxMigrationIntent': [
      sodax.migration.createRevertSodaToIcxMigrationIntent({ params: revertP, walletProvider: evm }),
      sodax.migration.createRevertSodaToIcxMigrationIntent({ params: revertP, raw: true }),
    ],
  }) as const;

// ICON-only migration actions.
const iconRows = () =>
  ({
    'migration.createMigrateBalnIntent': [
      sodax.migration.createMigrateBalnIntent({ params: balnP, walletProvider: iconWallet }),
      sodax.migration.createMigrateBalnIntent({ params: balnP, raw: true }),
    ],
    'migration.createMigrateIcxToSodaIntent': [
      sodax.migration.createMigrateIcxToSodaIntent({ params: icxP, walletProvider: iconWallet }),
      sodax.migration.createMigrateIcxToSodaIntent({ params: icxP, raw: true }),
    ],
  }) as const;

// `swaps.createIntent` on one chain of every family. Hash and raw types are spelled out, not derived
// through `TxReturnType`, so a regression in the per-chain return-type map also fails here.
declare const solanaP: CreateIntentParams<typeof ChainKeys.SOLANA_MAINNET>;
declare const stellarP: CreateIntentParams<typeof ChainKeys.STELLAR_MAINNET>;
declare const suiP: CreateIntentParams<typeof ChainKeys.SUI_MAINNET>;
declare const iconP: CreateIntentParams<ICON>;
declare const injectiveP: CreateIntentParams<typeof ChainKeys.INJECTIVE_MAINNET>;
declare const stacksP: CreateIntentParams<typeof ChainKeys.STACKS_MAINNET>;
declare const nearP: CreateIntentParams<typeof ChainKeys.NEAR_MAINNET>;
declare const bitcoinP: CreateIntentParams<typeof ChainKeys.BITCOIN_MAINNET>;
declare const solana: ISolanaWalletProvider;
declare const stellar: IStellarWalletProvider;
declare const sui: ISuiWalletProvider;
declare const injective: IInjectiveWalletProvider;
declare const stacks: IStacksWalletProvider;
declare const near: INearWalletProvider;
declare const bitcoin: IBitcoinWalletProvider;

const chainRows = () =>
  ({
    solana: [
      sodax.swaps.createIntent({ params: solanaP, walletProvider: solana }),
      sodax.swaps.createIntent({ params: solanaP, raw: true }),
    ],
    stellar: [
      sodax.swaps.createIntent({ params: stellarP, walletProvider: stellar }),
      sodax.swaps.createIntent({ params: stellarP, raw: true }),
    ],
    sui: [
      sodax.swaps.createIntent({ params: suiP, walletProvider: sui }),
      sodax.swaps.createIntent({ params: suiP, raw: true }),
    ],
    icon: [
      sodax.swaps.createIntent({ params: iconP, walletProvider: iconWallet }),
      sodax.swaps.createIntent({ params: iconP, raw: true }),
    ],
    injective: [
      sodax.swaps.createIntent({ params: injectiveP, walletProvider: injective }),
      sodax.swaps.createIntent({ params: injectiveP, raw: true }),
    ],
    stacks: [
      sodax.swaps.createIntent({ params: stacksP, walletProvider: stacks }),
      sodax.swaps.createIntent({ params: stacksP, raw: true }),
    ],
    near: [
      sodax.swaps.createIntent({ params: nearP, walletProvider: near }),
      sodax.swaps.createIntent({ params: nearP, raw: true }),
    ],
    bitcoin: [
      sodax.swaps.createIntent({ params: bitcoinP, walletProvider: bitcoin }),
      sodax.swaps.createIntent({ params: bitcoinP, raw: true }),
    ],
  }) as const;

describe('execution mode — result type follows the mode, no type arguments', () => {
  it('every EVM action: walletProvider → Hex, raw: true → EvmRawTransaction', () => {
    type T = ReturnType<typeof evmRows>;
    expectTypeOf<Mismatches<T, Uniform<T, Hex, EvmRawTransaction>>>().toEqualTypeOf<None>();
  });

  it('ICON-only migration actions: walletProvider → Hex, raw: true → IconRawTransaction', () => {
    type T = ReturnType<typeof iconRows>;
    expectTypeOf<Mismatches<T, Uniform<T, Hex, IconRawTransaction>>>().toEqualTypeOf<None>();
  });

  it('non-EVM chains narrow to their own hash and raw transaction types', () => {
    expectTypeOf<
      Mismatches<
        ReturnType<typeof chainRows>,
        {
          solana: [string, SolanaRawTransaction];
          stellar: [string, StellarRawTransaction];
          sui: [string, SuiRawTransaction];
          icon: [Hex, IconRawTransaction];
          injective: [string, InjectiveRawTransaction];
          stacks: [string, StacksRawTransaction];
          near: [string, NearRawTransaction];
          // Bitcoin's raw type already includes the hash string, so only its signed side can catch a union.
          bitcoin: [string, BitcoinRawTransaction | string];
        }
      >
    >().toEqualTypeOf<None>();
  });

  it('explicit raw: false matches the omitted form', () => {
    const call = () => sodax.swaps.approve({ params: swapP, raw: false, walletProvider: evm });
    expectTypeOf<Ok<ReturnType<typeof call>>>().toEqualTypeOf<Hex>();
  });

  it('a mode only known at runtime keeps both results, inferred from the argument', () => {
    const call = (args: SwapActionParams<BSC, boolean>) => sodax.swaps.approve(args);
    expectTypeOf<Ok<ReturnType<typeof call>>>().toEqualTypeOf<Hex | EvmRawTransaction>();
    const ternary = () =>
      sodax.swaps.approve(isRaw ? { params: swapP, raw: true } : { params: swapP, raw: false, walletProvider: evm });
    expectTypeOf<Ok<ReturnType<typeof ternary>>>().toEqualTypeOf<Hex | EvmRawTransaction>();
  });

  it('rejects mixed or missing modes', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      sodax.swaps.approve({ params: swapP, raw: true, walletProvider: evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      sodax.swaps.approve({ params: swapP }),
      // @ts-expect-error — raw: false still needs a walletProvider.
      sodax.swaps.approve({ params: swapP, raw: false }),
      // @ts-expect-error — the walletProvider must match the source chain.
      sodax.swaps.approve({ params: swapP, walletProvider: solana }),
      // @ts-expect-error — a non-literal boolean cannot pick a branch in an object literal.
      sodax.swaps.approve({ params: swapP, raw: isRaw }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});
