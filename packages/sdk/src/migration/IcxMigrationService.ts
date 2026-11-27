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

/** Hub calldata for ICX/wICX ↔ SODA via the ICX migration contract; used by `MigrationService`. */
export class IcxMigrationService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;

  constructor({ hubProvider, config }: IcxMigrationServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
  }

  /** SODA held by the ICX migration contract, i.e. the max ICX/wICX that can currently be migrated. */
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
