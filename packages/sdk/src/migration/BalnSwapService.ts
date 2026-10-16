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
// packages/sdk/src/services/hub/BalnSwapService.ts
import { type Address, type Hex, type PublicClient, encodeFunctionData } from 'viem';
import { balnSwapAbi } from '../shared/abis/balnSwap.abi.js';
import type { HubProvider } from '../shared/types/types.js';
import { encodeContractCalls, Erc20Service } from '../shared/index.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import { getEvmViemChain } from '../shared/utils/constant-utils.js';
import type { ConfigService } from '../shared/config/ConfigService.js';

/**
 * Lockup periods in seconds
 */
export enum LockupPeriod {
  NO_LOCKUP = 0,
  SIX_MONTHS = 6 * 30 * 24 * 60 * 60, // 6 months
  TWELVE_MONTHS = 12 * 30 * 24 * 60 * 60, // 12 months
  EIGHTEEN_MONTHS = 18 * 30 * 24 * 60 * 60, // 18 months
  TWENTY_FOUR_MONTHS = 24 * 30 * 24 * 60 * 60, // 24 months
}

/**
 * Reward multipliers (in basis points, 10000 = 1.0)
 */
export enum LockupMultiplier {
  NO_LOCKUP_MULTIPLIER = 5000, // 0.5x
  SIX_MONTHS_MULTIPLIER = 7500, // 0.75x
  TWELVE_MONTHS_MULTIPLIER = 10000, // 1.0x
  EIGHTEEN_MONTHS_MULTIPLIER = 12500, // 1.25x
  TWENTY_FOUR_MONTHS_MULTIPLIER = 15000, // 1.5x
}

/**
 * Unstake request information from the staked SODA contract.
 */
export type UnstakeRequest = {
  /** The amount being unstaked */
  amount: bigint;
  /** The start time of the unstake request */
  startTime: bigint;
  /** The address to receive the unstaked tokens */
  to: Address;
};

/**
 * Detailed lock information structure returned by the BALN swap contract.
 */
export type DetailedLock = {
  /** The amount of BALN tokens in the lock */
  balnAmount: bigint;
  /** The amount of SODA tokens in the lock */
  sodaAmount: bigint;
  /** The unlock time for the lock */
  unlockTime: bigint;
  /** The amount of xSODA tokens in the lock */
  xSodaAmount: bigint;
  /** The unstaking ID for the lock */
  unstakingId: bigint;
  /** The unstake request information */
  unstakeRequest: UnstakeRequest;
  /** The amount of staked SODA tokens */
  stakedSodaAmount: bigint;
};

/**
 * Parameters for BALN swap operations.
 */
export type BalnMigrateAction<Raw extends boolean> = SpokeExecActionParams<IconChainKey, Raw, BalnMigrateParams>;

export type BalnMigrateParams = {
  srcChainKey: IconChainKey;
  /** The source address of the BALN tokens */
  srcAddress: IconAddress;
  /** The amount of BALN tokens to swap */
  amount: bigint;
  /** The lockup period for the swap */
  lockupPeriod: LockupPeriod;
  /** The address that will receive the swapped SODA tokens */
  dstAddress: Address;
  /** Whether to stake the SODA tokens */
  stake: boolean;
};

/**
 * Parameters for BALN lock operations.
 */
export type BalnLockParams = {
  /** The lock ID to operate on */
  lockId: bigint;
};

export type BalnSwapServiceConstructorParams = {
  hubProvider: HubProvider;
};

/**
 * Low-level service for encoding and executing BALN→SODA swap operations on the hub chain (Sonic).
 *
 * This service is used internally by `MigrationService` and can also be called directly for
 * post-migration lock management. It covers:
 * - Encoding the BALN deposit calldata with lock-up period selection (`swapData`)
 * - Lock lifecycle management: `claim`, `claimUnstaked`, `stake`, `unstake`, `cancelUnstake`
 * - Reading lock details (`getDetailedUserLocks`)
 * - Calculating the SODA output amount offline (`calculateSodaAmount`)
 *
 * Lock-up periods (0–24 months) determine a reward multiplier (0.5×–1.5×) applied to the
 * SODA amount received in exchange for BALN tokens.
 */
export class BalnSwapService {
  private readonly hubProvider: HubProvider;

  constructor({ hubProvider }: BalnSwapServiceConstructorParams) {
    this.hubProvider = hubProvider;
  }

  /**
   * Returns the reward multiplier (in basis points, where 10 000 = 1.0×) for a given lock-up period.
   *
   * @param lockupPeriod - One of the `LockupPeriod` enum values.
   * @returns The multiplier as a `bigint` (e.g. `5000n` for 0.5×, `15000n` for 1.5×).
   * @throws If `lockupPeriod` does not match any `LockupPeriod` enum variant.
   */
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

  /**
   * Calculates the SODA amount that would be received for a given BALN amount and lock-up period,
   * using the fixed on-chain multiplier table — no contract call required.
   *
   * Formula: `sodaAmount = balnAmount * multiplier / 10_000`
   *
   * @param balnAmount - The amount of BALN tokens to swap (in BALN wei).
   * @param lockupPeriod - The desired lock-up period.
   * @returns The expected SODA amount (in SODA wei) before any on-chain rounding.
   */
  calculateSodaAmount(balnAmount: bigint, lockupPeriod: LockupPeriod): bigint {
    const multiplier = this.getMultiplierForPeriod(lockupPeriod);
    const basisPoints = 10000n;

    // SODA amount = BALN amount * multiplier / basis points
    return (balnAmount * multiplier) / basisPoints;
  }

  /**
   * Encodes the hub execution calldata for a BALN → SODA swap.
   *
   * Produces a batched contract call sequence:
   * 1. Approve the BALN hub-asset token to the BALN swap contract.
   * 2. Call `swap(amount, lockupPeriod, dstAddress, stake)` on the BALN swap contract.
   *
   * The returned hex is intended to be passed as `data` in a spoke `deposit` call so the
   * user's hub wallet executes it atomically on arrival.
   *
   * @param balnToken - The ICON contract address of the BALN token on ICON mainnet.
   * @param params - Swap parameters: amount, lock-up period, destination EVM address, and stake flag.
   * @param configService - `ConfigService` instance used to look up the BALN hub-asset address.
   * @returns ABI-encoded batch of contract calls ready for hub execution.
   * @throws If the hub asset configuration for the given BALN token is not found in `ConfigService`.
   */
  swapData(balnToken: IconContractAddress, params: BalnMigrateParams, configService: ConfigService): Hex {
    const assetConfig = configService.getSpokeTokenFromOriginalAssetAddress(ChainKeys.ICON_MAINNET, balnToken);
    invariant(assetConfig, `hub asset not found for baln token: ${balnToken}`);

    const calls: EvmContractCall[] = [];

    // Approve BALN tokens for the swap contract
    calls.push(
      Erc20Service.encodeApprove(assetConfig.hubAsset, this.hubProvider.chainConfig.addresses.balnSwap, params.amount),
    );
    calls.push(this.encodeSwap(params.amount, params.lockupPeriod, params.dstAddress, params.stake));

    return encodeContractCalls(calls);
  }

  /**
   * Claims unlocked SODA tokens from a completed BALN swap lock on the hub chain.
   *
   * @param user - The EVM address of the lock owner on the Sonic hub.
   * @param params - Lock parameters containing the `lockId` to claim from.
   * @param walletProviderSlot - Wallet provider slot controlling `raw` mode and the Sonic
   *   wallet provider used to sign and broadcast the transaction.
   * @returns The Sonic transaction hash (`R extends false`) or the unsigned transaction
   *   object (`R extends true`).
   */
  async claim<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const claimTx = this.encodeClaim(params.lockId);
    return await this.call(user, claimTx, walletProviderSlot);
  }

  /**
   * Claims SODA tokens from a completed unstaking request on a BALN swap lock.
   *
   * @param user - The EVM address of the lock owner on the Sonic hub.
   * @param params - Lock parameters containing the `lockId` to claim unstaked tokens from.
   * @param walletProviderSlot - Wallet provider slot controlling `raw` mode and the Sonic
   *   wallet provider used to sign and broadcast the transaction.
   * @returns The Sonic transaction hash (`R extends false`) or the unsigned transaction
   *   object (`R extends true`).
   */
  async claimUnstaked<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const claimUnstakedTx = this.encodeClaimUnstaked(params.lockId);
    return await this.call(user, claimUnstakedTx, walletProviderSlot);
  }

  /**
   * Stakes SODA tokens held in a BALN swap lock into the xSoda vault.
   *
   * @param user - The EVM address of the lock owner on the Sonic hub.
   * @param params - Lock parameters containing the `lockId` to stake.
   * @param walletProviderSlot - Wallet provider slot controlling `raw` mode and the Sonic
   *   wallet provider used to sign and broadcast the transaction.
   * @returns The Sonic transaction hash (`R extends false`) or the unsigned transaction
   *   object (`R extends true`).
   */
  async stake<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const stakeTx = this.encodeStake(params.lockId);
    return await this.call(user, stakeTx, walletProviderSlot);
  }

  /**
   * Initiates unstaking of xSoda tokens associated with a BALN swap lock.
   *
   * @param user - The EVM address of the lock owner on the Sonic hub.
   * @param params - Lock parameters containing the `lockId` to unstake.
   * @param walletProviderSlot - Wallet provider slot controlling `raw` mode and the Sonic
   *   wallet provider used to sign and broadcast the transaction.
   * @returns The Sonic transaction hash (`R extends false`) or the unsigned transaction
   *   object (`R extends true`).
   */
  async unstake<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const unstakeTx = this.encodeUnstake(params.lockId);
    return await this.call(user, unstakeTx, walletProviderSlot);
  }

  /**
   * Cancels a pending unstake request for a BALN swap lock, returning the xSoda tokens to
   * the staked state.
   *
   * @param user - The EVM address of the lock owner on the Sonic hub.
   * @param params - Lock parameters containing the `lockId` whose unstake request to cancel.
   * @param walletProviderSlot - Wallet provider slot controlling `raw` mode and the Sonic
   *   wallet provider used to sign and broadcast the transaction.
   * @returns The Sonic transaction hash (`R extends false`) or the unsigned transaction
   *   object (`R extends true`).
   */
  async cancelUnstake<R extends boolean = false>(
    user: Address,
    params: BalnLockParams,
    walletProviderSlot: WalletProviderSlot<SonicChainKey, R>,
  ): Promise<TxReturnType<SonicChainKey, R>> {
    const cancelUnstakeTx = this.encodeCancelUnstake(params.lockId);
    return await this.call(user, cancelUnstakeTx, walletProviderSlot);
  }

  /**
   * Reads all BALN swap locks for a user, including SODA/xSoda balances and any pending
   * unstake requests.
   *
   * @param publicClient - A viem `PublicClient` connected to the Sonic hub chain.
   * @param user - The EVM address of the user to query locks for.
   * @returns An immutable array of `DetailedLock` objects, one per active lock.
   */
  async getDetailedUserLocks(publicClient: PublicClient, user: Address): Promise<readonly DetailedLock[]> {
    return await publicClient.readContract({
      address: this.hubProvider.chainConfig.addresses.balnSwap,
      abi: balnSwapAbi,
      functionName: 'getDetailedUserLocks',
      args: [user],
    });
  }

  // ===== ENCODING METHODS =====

  /**
   * Encodes a single `swap` call on the BALN swap contract.
   *
   * @param amount - The amount of BALN hub-asset tokens to swap.
   * @param lockupPeriod - The lock-up duration that determines the SODA multiplier.
   * @param to - The EVM address that will receive the resulting SODA (or xSoda if `stake` is `true`).
   * @param stake - If `true`, the received SODA tokens are immediately staked into xSoda.
   * @returns A single `EvmContractCall` targeting the BALN swap contract.
   */
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

  /**
   * Encodes a single `claim` call on the BALN swap contract.
   *
   * @param lockId - The ID of the lock to claim SODA tokens from.
   * @returns A single `EvmContractCall` targeting the BALN swap contract.
   */
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

  /**
   * Encodes a single `claimUnstaked` call on the BALN swap contract.
   *
   * @param lockId - The ID of the lock to claim tokens from after the unstaking period expires.
   * @returns A single `EvmContractCall` targeting the BALN swap contract.
   */
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

  /**
   * Encodes a single `stake` call on the BALN swap contract.
   *
   * @param lockId - The ID of the lock whose SODA tokens should be staked into xSoda.
   * @returns A single `EvmContractCall` targeting the BALN swap contract.
   */
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

  /**
   * Encodes a single `unstake` call on the BALN swap contract.
   *
   * @param lockId - The ID of the lock whose xSoda tokens should be unstaked.
   * @returns A single `EvmContractCall` targeting the BALN swap contract.
   */
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

  /**
   * Encodes a single `cancelUnstake` call on the BALN swap contract.
   *
   * @param lockId - The ID of the lock whose pending unstake request should be cancelled.
   * @returns A single `EvmContractCall` targeting the BALN swap contract.
   */
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

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Executes a single pre-encoded contract call on the Sonic hub chain.
   *
   * When `walletProviderSlot.raw` is `true` the unsigned transaction object is returned
   * immediately without broadcasting. Otherwise the call is signed and broadcast via the
   * provided wallet provider.
   *
   * @param srcAddress - The `from` address for the transaction.
   * @param rawTx - The pre-encoded contract call to execute.
   * @param walletProviderSlot - Wallet provider slot that controls `raw` mode and holds the
   *   Sonic wallet provider.
   * @returns The Sonic transaction hash (`R extends false`) or the unsigned transaction
   *   object (`R extends true`).
   */
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
