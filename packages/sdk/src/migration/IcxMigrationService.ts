import { type Address, type Hex, encodeFunctionData } from 'viem';
import { erc20Abi } from '../shared/abis/index.js';
import { encodeContractCalls, Erc20Service, EvmAssetManagerService, type HubProvider } from '../shared/index.js';
import { icxSwapAbi } from '../shared/abis/icxSwap.abi.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import { lookupFailed } from '../errors/wrappers.js';
import { type MigrationLookupError, isMigrationLookupError } from './errors.js';
import {
  ChainKeys,
  type IconEoaAddress,
  type IconAddress,
  type EvmContractCall,
  type IcxTokenType,
  type IconChainKey,
  type Result,
  type SonicChainKey,
  type SpokeExecActionParams,
} from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';

export type IcxMigrateAction<Raw extends boolean> = SpokeExecActionParams<IconChainKey, Raw, IcxMigrateParams>;

export type IcxMigrateParams = {
  srcAddress: IconAddress;
  srcChainKey: IconChainKey; // should be ChainKeys.ICON_MAINNET
  address: IcxTokenType; // The ICON address of the ICX or wICX token to migrate
  amount: bigint; // The amount of ICX or wICX to migrate
  dstAddress: Address; // The address that will receive the migrated assets
};

export type IcxRevertMigrationAction<Raw extends boolean> = SpokeExecActionParams<
  SonicChainKey,
  Raw,
  IcxCreateRevertMigrationParams
>;

export type IcxCreateRevertMigrationParams = {
  srcAddress: Address; // should be Sonic original address
  srcChainKey: SonicChainKey; // should be ChainKeys.SONIC_MAINNET
  amount: bigint; // The amount of wICX to migrate
  dstAddress: IconEoaAddress; // The address that will receive the migrated SODA tokens as ICX
};

export type IcxRevertMigrationParams = {
  wICX: IconAddress; // The ICON address of the wICX token
  amount: bigint; // The amount of SODA tokens to migrate to ICX
  userWallet: Address; // The hub wallet address that will migrate assets
  dstAddress: Hex; // The Icon address that will receive the migrated SODA tokens as ICX
};

export type IcxMigrationServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
};

/**
 * Low-level service for encoding ICX/wICX ↔ SODA migration calldata executed on the hub chain (Sonic).
 *
 * This service is used internally by `MigrationService` and should not be called directly.
 * It encodes the hub-side contract call sequences required to:
 * - Swap wICX → SODA via the ICX migration contract (`migrateData`)
 * - Swap SODA → wICX and bridge back to ICON (`revertMigration`)
 *
 * It also exposes `getAvailableAmount` to check SODA liquidity in the migration contract
 * before initiating a forward migration, and `isReverseMigrationEnabled` to check the
 * contract's reverse-swap switch before a reverse migration.
 */
export class IcxMigrationService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;

  constructor({ hubProvider, config }: IcxMigrationServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
  }

  /**
   * Reads the SODA token balance held by the ICX migration contract on the hub chain.
   *
   * This balance represents the maximum amount of ICX/wICX that can currently be migrated.
   * `MigrationService.createMigrateIcxToSodaIntent` calls this method to gate migrations
   * when available liquidity is insufficient.
   *
   * @returns The SODA balance (in wei) of the ICX migration contract, or an error result if
   *   the on-chain read fails.
   */
  public async getAvailableAmount(): Promise<Result<bigint, MigrationLookupError>> {
    try {
      const value = await this.hubProvider.publicClient.readContract({
        address: this.hubProvider.chainConfig.addresses.sodaToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [this.hubProvider.chainConfig.addresses.icxMigration],
      });
      return { ok: true, value };
    } catch (error) {
      if (isMigrationLookupError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('migration', 'getAvailableAmount', error),
      };
    }
  }

  /**
   * Reads whether the ICX migration contract currently accepts reverse swaps (SODA → wICX).
   *
   * The contract owner can switch reverse swaps off; while off, `reverseSwap` reverts and so
   * does the whole hub transaction built by `revertMigration`.
   * `MigrationService.createRevertSodaToIcxMigrationIntent` and the ICX `approve` path call this
   * to fail fast instead of sending a transaction that cannot succeed.
   *
   * @returns `true` when reverse migration is enabled, or an error result if the on-chain read fails.
   */
  public async isReverseMigrationEnabled(): Promise<Result<boolean, MigrationLookupError>> {
    try {
      const value = await this.hubProvider.publicClient.readContract({
        address: this.hubProvider.chainConfig.addresses.icxMigration,
        abi: icxSwapAbi,
        functionName: 'reverseSwapEnabled',
      });
      return { ok: true, value };
    } catch (error) {
      if (isMigrationLookupError(error)) return { ok: false, error };
      return {
        ok: false,
        error: lookupFailed('migration', 'isReverseMigrationEnabled', error),
      };
    }
  }

  /**
   * Encodes the hub execution calldata for an ICX/wICX → SODA migration.
   *
   * Produces a batched contract call sequence:
   * 1. Approve the hub asset token to the ICX migration contract.
   * 2. Call `swap(amount, dstAddress)` on the ICX migration contract to receive SODA.
   *
   * The returned hex is intended to be passed as `data` in a spoke `deposit` call so
   * the hub wallet executes it atomically on arrival.
   *
   * @param params - Migration parameters: ICON source address, ICX/wICX token address (`address`),
   *   `amount`, and EVM destination address (`dstAddress`).
   * @returns ABI-encoded batch of contract calls ready for hub execution.
   * @throws If the hub asset configuration for the given token address is not found in `ConfigService`.
   */
  public migrateData(params: IcxMigrateParams): Hex {
    const calls: EvmContractCall[] = [];
    const token = this.config.getSpokeTokenFromOriginalAssetAddress(ChainKeys.ICON_MAINNET, params.address);
    invariant(token, `token not found for spoke chain token (token): ${params.address}`);

    calls.push(
      Erc20Service.encodeApprove(token.hubAsset, this.hubProvider.chainConfig.addresses.icxMigration, params.amount),
    );
    calls.push(this.encodeMigrate(params.amount, params.dstAddress));
    return encodeContractCalls(calls);
  }

  /**
   * Encodes the hub execution calldata for a SODA → wICX reverse migration.
   *
   * Produces a batched contract call sequence:
   * 1. Approve SODA to the ICX migration contract.
   * 2. Call `reverseSwap(amount, userWallet)` on the ICX migration contract to receive wICX.
   * 3. Transfer the resulting wICX hub-asset back to the ICON destination address via the
   *    asset manager.
   *
   * The returned hex is intended to be passed as `data` in a spoke `deposit` call so the
   * user's hub wallet executes it atomically on arrival.
   *
   * @param params - Revert parameters: wICX ICON token address, SODA amount, hub wallet address
   *   (`userWallet`), and ABI-encoded ICON destination address (`dstAddress`).
   * @returns ABI-encoded batch of contract calls ready for hub execution.
   * @throws If the hub asset configuration for the given wICX address is not found in `ConfigService`.
   */
  public revertMigration(params: IcxRevertMigrationParams): Hex {
    const calls: EvmContractCall[] = [];
    const token = this.config.getSpokeTokenFromOriginalAssetAddress(ChainKeys.ICON_MAINNET, params.wICX);
    invariant(token, `token not found for spoke chain token (token): ${params.wICX}`);

    calls.push(
      Erc20Service.encodeApprove(
        this.hubProvider.chainConfig.addresses.sodaToken,
        this.hubProvider.chainConfig.addresses.icxMigration,
        params.amount,
      ),
    );
    calls.push(this.encodeRevertMigration(params.amount, params.userWallet));
    calls.push(
      EvmAssetManagerService.encodeTransfer(
        token.hubAsset,
        params.dstAddress,
        params.amount,
        this.hubProvider.chainConfig.addresses.assetManager,
      ),
    );
    return encodeContractCalls(calls);
  }

  /**
   * Encodes a single `swap` call on the ICX migration contract (wICX → SODA).
   *
   * @param amount - The amount of wICX hub-asset tokens to swap.
   * @param to - The EVM address that will receive the resulting SODA tokens.
   * @returns A single `EvmContractCall` targeting the ICX migration contract.
   */
  public encodeMigrate(amount: bigint, to: Address): EvmContractCall {
    return {
      address: this.hubProvider.chainConfig.addresses.icxMigration,
      value: 0n,
      data: encodeFunctionData({
        abi: icxSwapAbi,
        functionName: 'swap',
        args: [amount, to],
      }),
    };
  }

  /**
   * Encodes a single `reverseSwap` call on the ICX migration contract (SODA → wICX).
   *
   * @param amount - The amount of SODA tokens to swap back to wICX.
   * @param to - The EVM address (typically the user's hub wallet) that will receive the wICX tokens.
   * @returns A single `EvmContractCall` targeting the ICX migration contract.
   */
  public encodeRevertMigration(amount: bigint, to: Address): EvmContractCall {
    return {
      address: this.hubProvider.chainConfig.addresses.icxMigration,
      value: 0n,
      data: encodeFunctionData({
        abi: icxSwapAbi,
        functionName: 'reverseSwap',
        args: [amount, to],
      }),
    };
  }
}
