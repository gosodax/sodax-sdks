/**
 * Pins StakingService. Every exec-mode action narrows by the source chain family and the execution mode
 * the caller picks, with no type arguments; the remaining methods have a single result type.
 */
import { describe, expectTypeOf, it } from 'vitest';
import {
  type Address,
  type BitcoinRawTransaction,
  type CancelUnstakeAction,
  type CancelUnstakeParams,
  ChainKeys,
  type ClaimAction,
  type ClaimParams,
  type EvmRawTransaction,
  type Hex,
  type IBitcoinWalletProvider,
  type IconRawTransaction,
  type IEvmWalletProvider,
  type IIconWalletProvider,
  type IInjectiveWalletProvider,
  type INearWalletProvider,
  type InjectiveRawTransaction,
  type InstantUnstakeAction,
  type InstantUnstakeParams,
  type ISolanaWalletProvider,
  type IStacksWalletProvider,
  type IStellarWalletProvider,
  type ISuiWalletProvider,
  type NearRawTransaction,
  type RelayExtraData,
  type Result,
  type SolanaRawTransaction,
  type SpokeChainKey,
  type StacksRawTransaction,
  type StakeAction,
  type StakeOrchestrationError,
  type StakeParams,
  type StakingAllowanceCheckError,
  type StakingApproveError,
  type StakingConfig,
  type StakingCreateIntentError,
  type StakingInfo,
  type StakingInfoFetchError,
  type StakingOrchestrationError,
  type StellarRawTransaction,
  type SuiRawTransaction,
  type TxHashPair,
  type UnstakeAction,
  type UnstakeParams,
  type UnstakeRequestWithPenalty,
  type UnstakingInfo,
} from '../index.js';
import type { StakingService } from './StakingService.js';

type BSC = typeof ChainKeys.BSC_MAINNET;
type SUI = typeof ChainKeys.SUI_MAINNET;

type P<K extends SpokeChainKey> = {
  stake: StakeParams<K>;
  unstake: UnstakeParams<K>;
  instantUnstake: InstantUnstakeParams<K>;
  claim: ClaimParams<K>;
  cancelUnstake: CancelUnstakeParams<K>;
};

type Approve<T> = Promise<Result<T, StakingApproveError>>;
type Intent<T> = Promise<Result<{ tx: T; relayData: RelayExtraData }, StakingCreateIntentError>>;
type Orchestrated = Promise<Result<TxHashPair, StakingOrchestrationError>>;
type Allowance = Promise<Result<boolean, StakingAllowanceCheckError>>;
type Info<T> = Promise<Result<T, StakingInfoFetchError>>;
// Per family: [walletProvider, raw: false, raw: true] for each exec-mode action, then the single-mode methods.
type Expected<Signed, Raw> = {
  readonly approve: readonly [Approve<Signed>, Approve<Signed>, Approve<Raw>];
  readonly createStakeIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly createUnstakeIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly createInstantUnstakeIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly createClaimIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly createCancelUnstakeIntent: readonly [Intent<Signed>, Intent<Signed>, Intent<Raw>];
  readonly stake: Promise<Result<TxHashPair, StakeOrchestrationError>>;
  readonly unstake: Orchestrated;
  readonly instantUnstake: Orchestrated;
  readonly claim: Orchestrated;
  readonly cancelUnstake: Orchestrated;
  readonly isAllowanceValid: readonly [Allowance, Allowance];
  readonly getStakingInfoFromSpoke: Info<StakingInfo>;
  readonly getUnstakingInfo: Info<UnstakingInfo>;
  readonly getUnstakingInfoWithPenalty: Info<UnstakingInfo & { requestsWithPenalty: UnstakeRequestWithPenalty[] }>;
};

declare const staking: StakingService;
declare const user: Address;
declare const isRaw: boolean;
declare const p: {
  evm: P<typeof ChainKeys.BSC_MAINNET>;
  hub: P<typeof ChainKeys.SONIC_MAINNET>;
  icon: P<typeof ChainKeys.ICON_MAINNET>;
  sui: P<typeof ChainKeys.SUI_MAINNET>;
  solana: P<typeof ChainKeys.SOLANA_MAINNET>;
  stellar: P<typeof ChainKeys.STELLAR_MAINNET>;
  injective: P<typeof ChainKeys.INJECTIVE_MAINNET>;
  stacks: P<typeof ChainKeys.STACKS_MAINNET>;
  near: P<typeof ChainKeys.NEAR_MAINNET>;
  bitcoin: P<typeof ChainKeys.BITCOIN_MAINNET>;
};
declare const w: {
  evm: IEvmWalletProvider;
  icon: IIconWalletProvider;
  sui: ISuiWalletProvider;
  solana: ISolanaWalletProvider;
  stellar: IStellarWalletProvider;
  injective: IInjectiveWalletProvider;
  stacks: IStacksWalletProvider;
  near: INearWalletProvider;
  bitcoin: IBitcoinWalletProvider;
};

// Never invoked: `staking`, `p`, `w` and `user` exist only at the type level.
const evmRows = () =>
  ({
    approve: [
      staking.approve({ params: p.evm.stake, walletProvider: w.evm }),
      staking.approve({ params: p.evm.stake, raw: false, walletProvider: w.evm }),
      staking.approve({ params: p.evm.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.evm.stake, walletProvider: w.evm }),
      staking.createStakeIntent({ params: p.evm.stake, raw: false, walletProvider: w.evm }),
      staking.createStakeIntent({ params: p.evm.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.evm.unstake, walletProvider: w.evm }),
      staking.createUnstakeIntent({ params: p.evm.unstake, raw: false, walletProvider: w.evm }),
      staking.createUnstakeIntent({ params: p.evm.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.evm.instantUnstake, walletProvider: w.evm }),
      staking.createInstantUnstakeIntent({ params: p.evm.instantUnstake, raw: false, walletProvider: w.evm }),
      staking.createInstantUnstakeIntent({ params: p.evm.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.evm.claim, walletProvider: w.evm }),
      staking.createClaimIntent({ params: p.evm.claim, raw: false, walletProvider: w.evm }),
      staking.createClaimIntent({ params: p.evm.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.evm.cancelUnstake, walletProvider: w.evm }),
      staking.createCancelUnstakeIntent({ params: p.evm.cancelUnstake, raw: false, walletProvider: w.evm }),
      staking.createCancelUnstakeIntent({ params: p.evm.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.evm.stake, walletProvider: w.evm }),
    unstake: staking.unstake({ params: p.evm.unstake, walletProvider: w.evm }),
    instantUnstake: staking.instantUnstake({ params: p.evm.instantUnstake, walletProvider: w.evm }),
    claim: staking.claim({ params: p.evm.claim, walletProvider: w.evm }),
    cancelUnstake: staking.cancelUnstake({ params: p.evm.cancelUnstake, walletProvider: w.evm }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.evm.stake, walletProvider: w.evm }),
      staking.isAllowanceValid({ params: p.evm.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.BSC_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.BSC_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.BSC_MAINNET),
  }) as const;

const hubRows = () =>
  ({
    approve: [
      staking.approve({ params: p.hub.stake, walletProvider: w.evm }),
      staking.approve({ params: p.hub.stake, raw: false, walletProvider: w.evm }),
      staking.approve({ params: p.hub.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.hub.stake, walletProvider: w.evm }),
      staking.createStakeIntent({ params: p.hub.stake, raw: false, walletProvider: w.evm }),
      staking.createStakeIntent({ params: p.hub.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.hub.unstake, walletProvider: w.evm }),
      staking.createUnstakeIntent({ params: p.hub.unstake, raw: false, walletProvider: w.evm }),
      staking.createUnstakeIntent({ params: p.hub.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.hub.instantUnstake, walletProvider: w.evm }),
      staking.createInstantUnstakeIntent({ params: p.hub.instantUnstake, raw: false, walletProvider: w.evm }),
      staking.createInstantUnstakeIntent({ params: p.hub.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.hub.claim, walletProvider: w.evm }),
      staking.createClaimIntent({ params: p.hub.claim, raw: false, walletProvider: w.evm }),
      staking.createClaimIntent({ params: p.hub.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.hub.cancelUnstake, walletProvider: w.evm }),
      staking.createCancelUnstakeIntent({ params: p.hub.cancelUnstake, raw: false, walletProvider: w.evm }),
      staking.createCancelUnstakeIntent({ params: p.hub.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.hub.stake, walletProvider: w.evm }),
    unstake: staking.unstake({ params: p.hub.unstake, walletProvider: w.evm }),
    instantUnstake: staking.instantUnstake({ params: p.hub.instantUnstake, walletProvider: w.evm }),
    claim: staking.claim({ params: p.hub.claim, walletProvider: w.evm }),
    cancelUnstake: staking.cancelUnstake({ params: p.hub.cancelUnstake, walletProvider: w.evm }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.hub.stake, walletProvider: w.evm }),
      staking.isAllowanceValid({ params: p.hub.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.SONIC_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.SONIC_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.SONIC_MAINNET),
  }) as const;

const iconRows = () =>
  ({
    approve: [
      staking.approve({ params: p.icon.stake, walletProvider: w.icon }),
      staking.approve({ params: p.icon.stake, raw: false, walletProvider: w.icon }),
      staking.approve({ params: p.icon.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.icon.stake, walletProvider: w.icon }),
      staking.createStakeIntent({ params: p.icon.stake, raw: false, walletProvider: w.icon }),
      staking.createStakeIntent({ params: p.icon.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.icon.unstake, walletProvider: w.icon }),
      staking.createUnstakeIntent({ params: p.icon.unstake, raw: false, walletProvider: w.icon }),
      staking.createUnstakeIntent({ params: p.icon.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.icon.instantUnstake, walletProvider: w.icon }),
      staking.createInstantUnstakeIntent({ params: p.icon.instantUnstake, raw: false, walletProvider: w.icon }),
      staking.createInstantUnstakeIntent({ params: p.icon.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.icon.claim, walletProvider: w.icon }),
      staking.createClaimIntent({ params: p.icon.claim, raw: false, walletProvider: w.icon }),
      staking.createClaimIntent({ params: p.icon.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.icon.cancelUnstake, walletProvider: w.icon }),
      staking.createCancelUnstakeIntent({ params: p.icon.cancelUnstake, raw: false, walletProvider: w.icon }),
      staking.createCancelUnstakeIntent({ params: p.icon.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.icon.stake, walletProvider: w.icon }),
    unstake: staking.unstake({ params: p.icon.unstake, walletProvider: w.icon }),
    instantUnstake: staking.instantUnstake({ params: p.icon.instantUnstake, walletProvider: w.icon }),
    claim: staking.claim({ params: p.icon.claim, walletProvider: w.icon }),
    cancelUnstake: staking.cancelUnstake({ params: p.icon.cancelUnstake, walletProvider: w.icon }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.icon.stake, walletProvider: w.icon }),
      staking.isAllowanceValid({ params: p.icon.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.ICON_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.ICON_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.ICON_MAINNET),
  }) as const;

const suiRows = () =>
  ({
    approve: [
      staking.approve({ params: p.sui.stake, walletProvider: w.sui }),
      staking.approve({ params: p.sui.stake, raw: false, walletProvider: w.sui }),
      staking.approve({ params: p.sui.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.sui.stake, walletProvider: w.sui }),
      staking.createStakeIntent({ params: p.sui.stake, raw: false, walletProvider: w.sui }),
      staking.createStakeIntent({ params: p.sui.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.sui.unstake, walletProvider: w.sui }),
      staking.createUnstakeIntent({ params: p.sui.unstake, raw: false, walletProvider: w.sui }),
      staking.createUnstakeIntent({ params: p.sui.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.sui.instantUnstake, walletProvider: w.sui }),
      staking.createInstantUnstakeIntent({ params: p.sui.instantUnstake, raw: false, walletProvider: w.sui }),
      staking.createInstantUnstakeIntent({ params: p.sui.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.sui.claim, walletProvider: w.sui }),
      staking.createClaimIntent({ params: p.sui.claim, raw: false, walletProvider: w.sui }),
      staking.createClaimIntent({ params: p.sui.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.sui.cancelUnstake, walletProvider: w.sui }),
      staking.createCancelUnstakeIntent({ params: p.sui.cancelUnstake, raw: false, walletProvider: w.sui }),
      staking.createCancelUnstakeIntent({ params: p.sui.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.sui.stake, walletProvider: w.sui }),
    unstake: staking.unstake({ params: p.sui.unstake, walletProvider: w.sui }),
    instantUnstake: staking.instantUnstake({ params: p.sui.instantUnstake, walletProvider: w.sui }),
    claim: staking.claim({ params: p.sui.claim, walletProvider: w.sui }),
    cancelUnstake: staking.cancelUnstake({ params: p.sui.cancelUnstake, walletProvider: w.sui }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.sui.stake, walletProvider: w.sui }),
      staking.isAllowanceValid({ params: p.sui.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.SUI_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.SUI_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.SUI_MAINNET),
  }) as const;

const solanaRows = () =>
  ({
    approve: [
      staking.approve({ params: p.solana.stake, walletProvider: w.solana }),
      staking.approve({ params: p.solana.stake, raw: false, walletProvider: w.solana }),
      staking.approve({ params: p.solana.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.solana.stake, walletProvider: w.solana }),
      staking.createStakeIntent({ params: p.solana.stake, raw: false, walletProvider: w.solana }),
      staking.createStakeIntent({ params: p.solana.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.solana.unstake, walletProvider: w.solana }),
      staking.createUnstakeIntent({ params: p.solana.unstake, raw: false, walletProvider: w.solana }),
      staking.createUnstakeIntent({ params: p.solana.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.solana.instantUnstake, walletProvider: w.solana }),
      staking.createInstantUnstakeIntent({ params: p.solana.instantUnstake, raw: false, walletProvider: w.solana }),
      staking.createInstantUnstakeIntent({ params: p.solana.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.solana.claim, walletProvider: w.solana }),
      staking.createClaimIntent({ params: p.solana.claim, raw: false, walletProvider: w.solana }),
      staking.createClaimIntent({ params: p.solana.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.solana.cancelUnstake, walletProvider: w.solana }),
      staking.createCancelUnstakeIntent({ params: p.solana.cancelUnstake, raw: false, walletProvider: w.solana }),
      staking.createCancelUnstakeIntent({ params: p.solana.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.solana.stake, walletProvider: w.solana }),
    unstake: staking.unstake({ params: p.solana.unstake, walletProvider: w.solana }),
    instantUnstake: staking.instantUnstake({ params: p.solana.instantUnstake, walletProvider: w.solana }),
    claim: staking.claim({ params: p.solana.claim, walletProvider: w.solana }),
    cancelUnstake: staking.cancelUnstake({ params: p.solana.cancelUnstake, walletProvider: w.solana }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.solana.stake, walletProvider: w.solana }),
      staking.isAllowanceValid({ params: p.solana.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.SOLANA_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.SOLANA_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.SOLANA_MAINNET),
  }) as const;

const stellarRows = () =>
  ({
    approve: [
      staking.approve({ params: p.stellar.stake, walletProvider: w.stellar }),
      staking.approve({ params: p.stellar.stake, raw: false, walletProvider: w.stellar }),
      staking.approve({ params: p.stellar.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.stellar.stake, walletProvider: w.stellar }),
      staking.createStakeIntent({ params: p.stellar.stake, raw: false, walletProvider: w.stellar }),
      staking.createStakeIntent({ params: p.stellar.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.stellar.unstake, walletProvider: w.stellar }),
      staking.createUnstakeIntent({ params: p.stellar.unstake, raw: false, walletProvider: w.stellar }),
      staking.createUnstakeIntent({ params: p.stellar.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.stellar.instantUnstake, walletProvider: w.stellar }),
      staking.createInstantUnstakeIntent({ params: p.stellar.instantUnstake, raw: false, walletProvider: w.stellar }),
      staking.createInstantUnstakeIntent({ params: p.stellar.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.stellar.claim, walletProvider: w.stellar }),
      staking.createClaimIntent({ params: p.stellar.claim, raw: false, walletProvider: w.stellar }),
      staking.createClaimIntent({ params: p.stellar.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.stellar.cancelUnstake, walletProvider: w.stellar }),
      staking.createCancelUnstakeIntent({ params: p.stellar.cancelUnstake, raw: false, walletProvider: w.stellar }),
      staking.createCancelUnstakeIntent({ params: p.stellar.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.stellar.stake, walletProvider: w.stellar }),
    unstake: staking.unstake({ params: p.stellar.unstake, walletProvider: w.stellar }),
    instantUnstake: staking.instantUnstake({ params: p.stellar.instantUnstake, walletProvider: w.stellar }),
    claim: staking.claim({ params: p.stellar.claim, walletProvider: w.stellar }),
    cancelUnstake: staking.cancelUnstake({ params: p.stellar.cancelUnstake, walletProvider: w.stellar }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.stellar.stake, walletProvider: w.stellar }),
      staking.isAllowanceValid({ params: p.stellar.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.STELLAR_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.STELLAR_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.STELLAR_MAINNET),
  }) as const;

const injectiveRows = () =>
  ({
    approve: [
      staking.approve({ params: p.injective.stake, walletProvider: w.injective }),
      staking.approve({ params: p.injective.stake, raw: false, walletProvider: w.injective }),
      staking.approve({ params: p.injective.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.injective.stake, walletProvider: w.injective }),
      staking.createStakeIntent({ params: p.injective.stake, raw: false, walletProvider: w.injective }),
      staking.createStakeIntent({ params: p.injective.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.injective.unstake, walletProvider: w.injective }),
      staking.createUnstakeIntent({ params: p.injective.unstake, raw: false, walletProvider: w.injective }),
      staking.createUnstakeIntent({ params: p.injective.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.injective.instantUnstake, walletProvider: w.injective }),
      staking.createInstantUnstakeIntent({
        params: p.injective.instantUnstake,
        raw: false,
        walletProvider: w.injective,
      }),
      staking.createInstantUnstakeIntent({ params: p.injective.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.injective.claim, walletProvider: w.injective }),
      staking.createClaimIntent({ params: p.injective.claim, raw: false, walletProvider: w.injective }),
      staking.createClaimIntent({ params: p.injective.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.injective.cancelUnstake, walletProvider: w.injective }),
      staking.createCancelUnstakeIntent({ params: p.injective.cancelUnstake, raw: false, walletProvider: w.injective }),
      staking.createCancelUnstakeIntent({ params: p.injective.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.injective.stake, walletProvider: w.injective }),
    unstake: staking.unstake({ params: p.injective.unstake, walletProvider: w.injective }),
    instantUnstake: staking.instantUnstake({ params: p.injective.instantUnstake, walletProvider: w.injective }),
    claim: staking.claim({ params: p.injective.claim, walletProvider: w.injective }),
    cancelUnstake: staking.cancelUnstake({ params: p.injective.cancelUnstake, walletProvider: w.injective }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.injective.stake, walletProvider: w.injective }),
      staking.isAllowanceValid({ params: p.injective.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.INJECTIVE_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.INJECTIVE_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.INJECTIVE_MAINNET),
  }) as const;

const stacksRows = () =>
  ({
    approve: [
      staking.approve({ params: p.stacks.stake, walletProvider: w.stacks }),
      staking.approve({ params: p.stacks.stake, raw: false, walletProvider: w.stacks }),
      staking.approve({ params: p.stacks.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.stacks.stake, walletProvider: w.stacks }),
      staking.createStakeIntent({ params: p.stacks.stake, raw: false, walletProvider: w.stacks }),
      staking.createStakeIntent({ params: p.stacks.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.stacks.unstake, walletProvider: w.stacks }),
      staking.createUnstakeIntent({ params: p.stacks.unstake, raw: false, walletProvider: w.stacks }),
      staking.createUnstakeIntent({ params: p.stacks.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.stacks.instantUnstake, walletProvider: w.stacks }),
      staking.createInstantUnstakeIntent({ params: p.stacks.instantUnstake, raw: false, walletProvider: w.stacks }),
      staking.createInstantUnstakeIntent({ params: p.stacks.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.stacks.claim, walletProvider: w.stacks }),
      staking.createClaimIntent({ params: p.stacks.claim, raw: false, walletProvider: w.stacks }),
      staking.createClaimIntent({ params: p.stacks.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.stacks.cancelUnstake, walletProvider: w.stacks }),
      staking.createCancelUnstakeIntent({ params: p.stacks.cancelUnstake, raw: false, walletProvider: w.stacks }),
      staking.createCancelUnstakeIntent({ params: p.stacks.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.stacks.stake, walletProvider: w.stacks }),
    unstake: staking.unstake({ params: p.stacks.unstake, walletProvider: w.stacks }),
    instantUnstake: staking.instantUnstake({ params: p.stacks.instantUnstake, walletProvider: w.stacks }),
    claim: staking.claim({ params: p.stacks.claim, walletProvider: w.stacks }),
    cancelUnstake: staking.cancelUnstake({ params: p.stacks.cancelUnstake, walletProvider: w.stacks }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.stacks.stake, walletProvider: w.stacks }),
      staking.isAllowanceValid({ params: p.stacks.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.STACKS_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.STACKS_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.STACKS_MAINNET),
  }) as const;

const nearRows = () =>
  ({
    approve: [
      staking.approve({ params: p.near.stake, walletProvider: w.near }),
      staking.approve({ params: p.near.stake, raw: false, walletProvider: w.near }),
      staking.approve({ params: p.near.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.near.stake, walletProvider: w.near }),
      staking.createStakeIntent({ params: p.near.stake, raw: false, walletProvider: w.near }),
      staking.createStakeIntent({ params: p.near.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.near.unstake, walletProvider: w.near }),
      staking.createUnstakeIntent({ params: p.near.unstake, raw: false, walletProvider: w.near }),
      staking.createUnstakeIntent({ params: p.near.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.near.instantUnstake, walletProvider: w.near }),
      staking.createInstantUnstakeIntent({ params: p.near.instantUnstake, raw: false, walletProvider: w.near }),
      staking.createInstantUnstakeIntent({ params: p.near.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.near.claim, walletProvider: w.near }),
      staking.createClaimIntent({ params: p.near.claim, raw: false, walletProvider: w.near }),
      staking.createClaimIntent({ params: p.near.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.near.cancelUnstake, walletProvider: w.near }),
      staking.createCancelUnstakeIntent({ params: p.near.cancelUnstake, raw: false, walletProvider: w.near }),
      staking.createCancelUnstakeIntent({ params: p.near.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.near.stake, walletProvider: w.near }),
    unstake: staking.unstake({ params: p.near.unstake, walletProvider: w.near }),
    instantUnstake: staking.instantUnstake({ params: p.near.instantUnstake, walletProvider: w.near }),
    claim: staking.claim({ params: p.near.claim, walletProvider: w.near }),
    cancelUnstake: staking.cancelUnstake({ params: p.near.cancelUnstake, walletProvider: w.near }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.near.stake, walletProvider: w.near }),
      staking.isAllowanceValid({ params: p.near.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.NEAR_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.NEAR_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.NEAR_MAINNET),
  }) as const;

const bitcoinRows = () =>
  ({
    approve: [
      staking.approve({ params: p.bitcoin.stake, walletProvider: w.bitcoin }),
      staking.approve({ params: p.bitcoin.stake, raw: false, walletProvider: w.bitcoin }),
      staking.approve({ params: p.bitcoin.stake, raw: true }),
    ],
    createStakeIntent: [
      staking.createStakeIntent({ params: p.bitcoin.stake, walletProvider: w.bitcoin }),
      staking.createStakeIntent({ params: p.bitcoin.stake, raw: false, walletProvider: w.bitcoin }),
      staking.createStakeIntent({ params: p.bitcoin.stake, raw: true }),
    ],
    createUnstakeIntent: [
      staking.createUnstakeIntent({ params: p.bitcoin.unstake, walletProvider: w.bitcoin }),
      staking.createUnstakeIntent({ params: p.bitcoin.unstake, raw: false, walletProvider: w.bitcoin }),
      staking.createUnstakeIntent({ params: p.bitcoin.unstake, raw: true }),
    ],
    createInstantUnstakeIntent: [
      staking.createInstantUnstakeIntent({ params: p.bitcoin.instantUnstake, walletProvider: w.bitcoin }),
      staking.createInstantUnstakeIntent({ params: p.bitcoin.instantUnstake, raw: false, walletProvider: w.bitcoin }),
      staking.createInstantUnstakeIntent({ params: p.bitcoin.instantUnstake, raw: true }),
    ],
    createClaimIntent: [
      staking.createClaimIntent({ params: p.bitcoin.claim, walletProvider: w.bitcoin }),
      staking.createClaimIntent({ params: p.bitcoin.claim, raw: false, walletProvider: w.bitcoin }),
      staking.createClaimIntent({ params: p.bitcoin.claim, raw: true }),
    ],
    createCancelUnstakeIntent: [
      staking.createCancelUnstakeIntent({ params: p.bitcoin.cancelUnstake, walletProvider: w.bitcoin }),
      staking.createCancelUnstakeIntent({ params: p.bitcoin.cancelUnstake, raw: false, walletProvider: w.bitcoin }),
      staking.createCancelUnstakeIntent({ params: p.bitcoin.cancelUnstake, raw: true }),
    ],
    stake: staking.stake({ params: p.bitcoin.stake, walletProvider: w.bitcoin }),
    unstake: staking.unstake({ params: p.bitcoin.unstake, walletProvider: w.bitcoin }),
    instantUnstake: staking.instantUnstake({ params: p.bitcoin.instantUnstake, walletProvider: w.bitcoin }),
    claim: staking.claim({ params: p.bitcoin.claim, walletProvider: w.bitcoin }),
    cancelUnstake: staking.cancelUnstake({ params: p.bitcoin.cancelUnstake, walletProvider: w.bitcoin }),
    isAllowanceValid: [
      staking.isAllowanceValid({ params: p.bitcoin.stake, walletProvider: w.bitcoin }),
      staking.isAllowanceValid({ params: p.bitcoin.stake, raw: true }),
    ],
    getStakingInfoFromSpoke: staking.getStakingInfoFromSpoke(user, ChainKeys.BITCOIN_MAINNET),
    getUnstakingInfo: staking.getUnstakingInfo(user, ChainKeys.BITCOIN_MAINNET),
    getUnstakingInfoWithPenalty: staking.getUnstakingInfoWithPenalty(user, ChainKeys.BITCOIN_MAINNET),
  }) as const;

describe('StakingService — exec-mode actions narrow by chain family and mode', () => {
  it('evm (BSC_MAINNET): Hex signed, EvmRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof evmRows>>().toEqualTypeOf<Expected<Hex, EvmRawTransaction>>();
  });

  it('hub (SONIC_MAINNET): Hex signed, EvmRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof hubRows>>().toEqualTypeOf<Expected<Hex, EvmRawTransaction>>();
  });

  it('icon (ICON_MAINNET): Hex signed, IconRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof iconRows>>().toEqualTypeOf<Expected<Hex, IconRawTransaction>>();
  });

  it('sui (SUI_MAINNET): string signed, SuiRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof suiRows>>().toEqualTypeOf<Expected<string, SuiRawTransaction>>();
  });

  it('solana (SOLANA_MAINNET): string signed, SolanaRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof solanaRows>>().toEqualTypeOf<Expected<string, SolanaRawTransaction>>();
  });

  it('stellar (STELLAR_MAINNET): string signed, StellarRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof stellarRows>>().toEqualTypeOf<Expected<string, StellarRawTransaction>>();
  });

  it('injective (INJECTIVE_MAINNET): string signed, InjectiveRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof injectiveRows>>().toEqualTypeOf<Expected<string, InjectiveRawTransaction>>();
  });

  it('stacks (STACKS_MAINNET): string signed, StacksRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof stacksRows>>().toEqualTypeOf<Expected<string, StacksRawTransaction>>();
  });

  it('near (NEAR_MAINNET): string signed, NearRawTransaction raw', () => {
    expectTypeOf<ReturnType<typeof nearRows>>().toEqualTypeOf<Expected<string, NearRawTransaction>>();
  });

  it('bitcoin (BITCOIN_MAINNET): string signed, BitcoinRawTransaction | string raw', () => {
    expectTypeOf<ReturnType<typeof bitcoinRows>>().toEqualTypeOf<Expected<string, BitcoinRawTransaction | string>>();
  });

  it('a mode only known at runtime keeps both results, inferred from the argument', () => {
    const approve = (args: StakeAction<BSC, boolean>) => staking.approve(args);
    const stake = (args: StakeAction<BSC, boolean>) => staking.createStakeIntent(args);
    const unstake = (args: UnstakeAction<SUI, boolean>) => staking.createUnstakeIntent(args);
    const instant = (args: InstantUnstakeAction<BSC, boolean>) => staking.createInstantUnstakeIntent(args);
    const claim = (args: ClaimAction<BSC, boolean>) => staking.createClaimIntent(args);
    const cancel = (args: CancelUnstakeAction<BSC, boolean>) => staking.createCancelUnstakeIntent(args);
    const ternary = () =>
      staking.createStakeIntent(
        isRaw ? { params: p.evm.stake, raw: true } : { params: p.evm.stake, raw: false, walletProvider: w.evm },
      );
    expectTypeOf<ReturnType<typeof approve>>().toEqualTypeOf<Approve<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof stake>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof unstake>>().toEqualTypeOf<Intent<string | SuiRawTransaction>>();
    expectTypeOf<ReturnType<typeof instant>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof claim>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof cancel>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
    expectTypeOf<ReturnType<typeof ternary>>().toEqualTypeOf<Intent<Hex | EvmRawTransaction>>();
  });

  it('rejects mixed modes, mismatched wallets, raw orchestration and mismatched actions', () => {
    const calls = () => [
      // @ts-expect-error — raw: true forbids walletProvider.
      staking.createStakeIntent({ params: p.evm.stake, raw: true, walletProvider: w.evm }),
      // @ts-expect-error — a signed call needs a walletProvider.
      staking.createUnstakeIntent({ params: p.evm.unstake }),
      // @ts-expect-error — raw: false still needs a walletProvider.
      staking.approve({ params: p.evm.stake, raw: false }),
      // @ts-expect-error — the walletProvider must match the source chain (Sui wallet on BSC).
      staking.createClaimIntent({ params: p.evm.claim, walletProvider: w.sui }),
      // @ts-expect-error — the walletProvider must match the source chain (EVM wallet on Icon).
      staking.createCancelUnstakeIntent({ params: p.icon.cancelUnstake, walletProvider: w.evm }),
      // @ts-expect-error — orchestrated actions broadcast and wait, so they have no raw mode.
      staking.stake({ params: p.evm.stake, raw: true }),
      // @ts-expect-error — orchestrated actions need a walletProvider.
      staking.claim({ params: p.evm.claim }),
      // @ts-expect-error — createStakeIntent only takes stake params.
      staking.createStakeIntent({ params: p.evm.unstake, walletProvider: w.evm }),
    ];
    expectTypeOf(calls).toBeFunction();
  });
});

describe('StakingService — single result type', () => {
  it('build*Data returns hub calldata', () => {
    expectTypeOf<ReturnType<StakingService['buildStakeData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<StakingService['buildUnstakeData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<StakingService['buildInstantUnstakeData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<StakingService['buildClaimData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<StakingService['buildCancelUnstakeData']>>().toEqualTypeOf<Promise<Hex>>();
  });

  it('hub reads', () => {
    expectTypeOf<ReturnType<StakingService['getStakingInfo']>>().toEqualTypeOf<Info<StakingInfo>>();
    expectTypeOf<ReturnType<StakingService['getStakingConfig']>>().toEqualTypeOf<Info<StakingConfig>>();
    expectTypeOf<ReturnType<StakingService['getInstantUnstakeRatio']>>().toEqualTypeOf<Info<bigint>>();
    expectTypeOf<ReturnType<StakingService['getConvertedAssets']>>().toEqualTypeOf<Info<bigint>>();
    expectTypeOf<ReturnType<StakingService['getStakeRatio']>>().toEqualTypeOf<Info<[bigint, bigint]>>();
  });
});
