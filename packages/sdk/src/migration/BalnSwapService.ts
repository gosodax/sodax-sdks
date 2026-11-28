import {
  ChainKeys,
  type EvmContractCall,
  type IconAddress,
  type IconChainKey,
  type IconContractAddress,
  type SonicChainKey,
  type SpokeExecActionParams,
  type TxReturnType,
  type WalletProviderSlot,
} from '@sodax/types';
import { type Address, type Hex, type PublicClient, encodeFunctionData } from 'viem';
import { balnSwapAbi } from '../shared/abis/balnSwap.abi.js';
import type { HubProvider } from '../shared/types/types.js';
import { encodeContractCalls, Erc20Service } from '../shared/index.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import { getEvmViemChain } from '../shared/utils/constant-utils.js';
import type { ConfigService } from '../shared/config/ConfigService.js';

/** Lockup periods in seconds (a month counts as 30 days). */
export enum LockupPeriod {
  NO_LOCKUP = 0,
  SIX_MONTHS = 6 * 30 * 24 * 60 * 60, // 6 months
  TWELVE_MONTHS = 12 * 30 * 24 * 60 * 60, // 12 months
  EIGHTEEN_MONTHS = 18 * 30 * 24 * 60 * 60, // 18 months
  TWENTY_FOUR_MONTHS = 24 * 30 * 24 * 60 * 60, // 24 months
}

/** Reward multipliers in basis points (10000 = 1.0x). */
export enum LockupMultiplier {
  NO_LOCKUP_MULTIPLIER = 5000, // 0.5x
  SIX_MONTHS_MULTIPLIER = 7500, // 0.75x
  TWELVE_MONTHS_MULTIPLIER = 10000, // 1.0x
  EIGHTEEN_MONTHS_MULTIPLIER = 12500, // 1.25x
  TWENTY_FOUR_MONTHS_MULTIPLIER = 15000, // 1.5x
}

export type UnstakeRequest = {
  amount: bigint;
  startTime: bigint;
  to: Address;
};

export type DetailedLock = {
  balnAmount: bigint;
  sodaAmount: bigint;
  unlockTime: bigint;
  xSodaAmount: bigint;
  unstakingId: bigint;
  unstakeRequest: UnstakeRequest;
  stakedSodaAmount: bigint;
};

export type BalnMigrateAction<Raw extends boolean> = SpokeExecActionParams<IconChainKey, Raw, BalnMigrateParams>;

export type BalnMigrateParams = {
  srcChainKey: IconChainKey;
  srcAddress: IconAddress;
  amount: bigint;
  lockupPeriod: LockupPeriod;
  dstAddress: Address;
  stake: boolean;
};

export type BalnLockParams = {
  lockId: bigint;
};

export type BalnSwapServiceConstructorParams = {
  hubProvider: HubProvider;
};

/** BALN → SODA swap encoding and post-migration lock management on the hub. */
export class BalnSwapService {
  private readonly hubProvider: HubProvider;

  constructor({ hubProvider }: BalnSwapServiceConstructorParams) {
    this.hubProvider = hubProvider;
  }

  getMultiplierForPeriod(lockupPeriod: LockupPeriod): bigint {
    switch (lockupPeriod) {
      case LockupPeriod.NO_LOCKUP:
        return BigInt(LockupMultiplier.NO_LOCKUP_MULTIPLIER);
      case LockupPeriod.SIX_MONTHS:
        return BigInt(LockupMultiplier.SIX_MONTHS_MULTIPLIER);
      case LockupPeriod.TWELVE_MONTHS:
        return BigInt(LockupMultiplier.TWELVE_MONTHS_MULTIPLIER);
      case LockupPeriod.EIGHTEEN_MONTHS:
        return BigInt(LockupMultiplier.EIGHTEEN_MONTHS_MULTIPLIER);
      case LockupPeriod.TWENTY_FOUR_MONTHS:
        return BigInt(LockupMultiplier.TWENTY_FOUR_MONTHS_MULTIPLIER);
      default:
        throw new Error(`Invalid lockup period: ${lockupPeriod}`);
    }
  }

  /** Computed offline from the fixed multiplier table; on-chain rounding may differ. */
  calculateSodaAmount(balnAmount: bigint, lockupPeriod: LockupPeriod): bigint {
    const multiplier = this.getMultiplierForPeriod(lockupPeriod);
    const basisPoints = 10000n;

    return (balnAmount * multiplier) / basisPoints;
  }

  swapData(balnToken: IconContractAddress, params: BalnMigrateParams, configService: ConfigService): Hex {
    const assetConfig = configService.getSpokeTokenFromOriginalAssetAddress(ChainKeys.ICON_MAINNET, balnToken);
    invariant(assetConfig, `hub asset not found for baln token: ${balnToken}`);

    const calls: EvmContractCall[] = [];

    calls.push(
      Erc20Service.encodeApprove(assetConfig.hubAsset, this.hubProvider.chainConfig.addresses.balnSwap, params.amount),
    );
    calls.push(this.encodeSwap(params.amount, params.lockupPeriod, params.dstAddress, params.stake));

    return encodeContractCalls(calls);
  }

  async claim<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const claimTx = this.encodeClaim(params.lockId);
    return await this.call(user, claimTx, walletProviderSlot);
  }

  async claimUnstaked<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const claimUnstakedTx = this.encodeClaimUnstaked(params.lockId);
    return await this.call(user, claimUnstakedTx, walletProviderSlot);
  }

  async stake<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const stakeTx = this.encodeStake(params.lockId);
    return await this.call(user, stakeTx, walletProviderSlot);
  }

  async unstake<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const unstakeTx = this.encodeUnstake(params.lockId);
    return await this.call(user, unstakeTx, walletProviderSlot);
  }

  async cancelUnstake<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const cancelUnstakeTx = this.encodeCancelUnstake(params.lockId);
    return await this.call(user, cancelUnstakeTx, walletProviderSlot);
  }

  async getDetailedUserLocks(publicClient: PublicClient, user: Address): Promise<readonly DetailedLock[]> {
    return await publicClient.readContract({
      address: this.hubProvider.chainConfig.addresses.balnSwap,
      abi: balnSwapAbi,
      functionName: 'getDetailedUserLocks',
      args: [user],
    });
  }

  encodeSwap(amount: bigint, lockupPeriod: LockupPeriod, to: Address, stake: boolean): EvmContractCall {
    return {
      address: this.hubProvider.chainConfig.addresses.balnSwap,
      value: 0n,
      data: encodeFunctionData({
        abi: balnSwapAbi,
        functionName: 'swap',
        args: [amount, BigInt(lockupPeriod), to, stake],
      }),
    };
  }

  encodeClaim(lockId: bigint): EvmContractCall {
    return {
      address: this.hubProvider.chainConfig.addresses.balnSwap,
      value: 0n,
      data: encodeFunctionData({
        abi: balnSwapAbi,
        functionName: 'claim',
        args: [lockId],
      }),
    };
  }

  encodeClaimUnstaked(lockId: bigint): EvmContractCall {
    return {
      address: this.hubProvider.chainConfig.addresses.balnSwap,
      value: 0n,
      data: encodeFunctionData({
        abi: balnSwapAbi,
        functionName: 'claimUnstaked',
        args: [lockId],
      }),
    };
  }

  encodeStake(lockId: bigint): EvmContractCall {
    return {
      address: this.hubProvider.chainConfig.addresses.balnSwap,
      value: 0n,
      data: encodeFunctionData({
        abi: balnSwapAbi,
        functionName: 'stake',
        args: [lockId],
      }),
    };
  }

  encodeUnstake(lockId: bigint): EvmContractCall {
    return {
      address: this.hubProvider.chainConfig.addresses.balnSwap,
      value: 0n,
      data: encodeFunctionData({
        abi: balnSwapAbi,
        functionName: 'unstake',
        args: [lockId],
      }),
    };
  }

  encodeCancelUnstake(lockId: bigint): EvmContractCall {
    return {
      address: this.hubProvider.chainConfig.addresses.balnSwap,
      value: 0n,
      data: encodeFunctionData({
        abi: balnSwapAbi,
        functionName: 'cancelUnstake',
        args: [lockId],
      }),
    };
  }

  async call<R extends boolean = false>(
    srcAddress: Address,
    rawTx: EvmContractCall,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const tx = {
      from: srcAddress,
      to: rawTx.address,
      value: rawTx.value,
      data: rawTx.data,
    } satisfies TxReturnType<SonicChainKey, true>;

    if (walletProviderSlot.raw) {
      return tx satisfies TxReturnType<SonicChainKey, true> as TxReturnType<SonicChainKey, R>;
    }

    return walletProviderSlot.walletProvider.sendTransaction(tx, {
      expectedChainId: getEvmViemChain(ChainKeys.SONIC_MAINNET).id,
    }) satisfies Promise<TxReturnType<SonicChainKey, false>> as Promise<TxReturnType<SonicChainKey, R>>;
  }
}
