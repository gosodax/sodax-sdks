import type { Hex } from 'viem';
import {
  encodeContractCalls,
  Erc20Service,
  EvmAssetManagerService,
  type HubProvider,
  EvmVaultTokenService,
} from '../shared/index.js';
import { invariant } from '../shared/utils/tiny-invariant.js';
import type { EvmContractCall, SpokeChainKey, SpokeExecActionParams } from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';

export type UnifiedBnUSDMigrateAction<K extends SpokeChainKey, Raw extends boolean> = SpokeExecActionParams<
  K,
  Raw,
  UnifiedBnUSDMigrateParams<K>
> & { unchecked?: boolean };

export type UnifiedBnUSDMigrateParams<K extends SpokeChainKey> = {
  srcAddress: string;
  srcChainKey: K; // The source chain ID where bnUSD (legacy or new) token exists
  srcbnUSD: string; // The spoke address of the bnUSD source token to migrate
  dstChainKey: SpokeChainKey; // The destination chain ID for the migration
  dstbnUSD: string; // The spoke address of the bnUSD destination token to receive
  amount: bigint; // The amount of bnUSD to migrate
  dstAddress: string; // The spoke address that will receive the migrated new bnUSD tokens
};

type FormattedBnUSDMigrateParams = {
  srcChainKey: SpokeChainKey; // The source chain ID where the legacy bnUSD token exists
  legacybnUSD: string; // The spoke address of the legacy bnUSD token to migrate
  newbnUSD: string; // The spoke address of the new bnUSD token to receive
  amount: bigint; // The amount of legacy bnUSD to migrate
  dstAddress: Hex; // The encoded spoke address (translated to hub chain) that will receive the migrated new bnUSD tokens
  dstChainKey: SpokeChainKey; // The destination chain ID for the migration
};

export type BnUSDRevertMigrationParams = {
  srcChainKey: SpokeChainKey; // The source chain key where the new bnUSD token exists
  legacybnUSD: string; // The ICON address of the legacy bnUSD token to receive
  newbnUSD: string; // The ICON address of the new bnUSD token to migrate from
  amount: bigint; // The amount of new bnUSD tokens to migrate back
  dstAddress: Hex; // The spoke chain address that will receive the migrated legacy bnUSD tokens
  dstChainKey: SpokeChainKey; // The destination chain key for the migration
};

export type BnUSDMigrationServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
};

/** Hub calldata for legacy (ICON/Sui/Stellar) ↔ new bnUSD, routed through the shared `bnUSDVault`. */
export class BnUSDMigrationService {
  private readonly hubProvider: HubProvider;
  private readonly config: ConfigService;

  constructor({ hubProvider, config }: BnUSDMigrationServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.config = config;
  }

  public migrateData(params: FormattedBnUSDMigrateParams): Hex {
    const calls: EvmContractCall[] = [];
    const assetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.legacybnUSD);
    invariant(assetConfig, `hub asset not found for legacy bnUSD token: ${params.legacybnUSD}`);

    const bnUSDVault = this.config.moneyMarket.bnUSDVault;

    calls.push(Erc20Service.encodeApprove(assetConfig.hubAsset, assetConfig.vault, params.amount));
    calls.push(EvmVaultTokenService.encodeDeposit(assetConfig.vault, assetConfig.hubAsset, params.amount));

    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(assetConfig.decimals, params.amount);
    calls.push(Erc20Service.encodeApprove(assetConfig.vault, bnUSDVault, translatedAmount));
    calls.push(EvmVaultTokenService.encodeDeposit(bnUSDVault, assetConfig.vault, translatedAmount));

    // Destination is the hub bnUSD vault itself: transfer vault shares directly.
    if (params.newbnUSD.toLowerCase() === bnUSDVault.toLowerCase()) {
      calls.push(Erc20Service.encodeTransfer(bnUSDVault, params.dstAddress, translatedAmount));
      return encodeContractCalls(calls);
    }

    const dstAssetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.newbnUSD);
    invariant(dstAssetConfig, `hub asset not found for new bnUSD token: ${params.newbnUSD}`);

    calls.push(EvmVaultTokenService.encodeWithdraw(bnUSDVault, dstAssetConfig.hubAsset, translatedAmount));
    const translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(
      dstAssetConfig.decimals,
      translatedAmount,
    );
    calls.push(
      EvmAssetManagerService.encodeTransfer(
        dstAssetConfig.hubAsset,
        params.dstAddress,
        translatedAmountOut,
        this.hubProvider.chainConfig.addresses.assetManager,
      ),
    );

    return encodeContractCalls(calls);
  }

  public revertMigrationData(params: BnUSDRevertMigrationParams): Hex {
    const calls: EvmContractCall[] = [];
    const bnUSDVault = this.config.moneyMarket.bnUSDVault;

    let decimals = 18;
    if (params.newbnUSD.toLowerCase() !== bnUSDVault.toLowerCase()) {
      const assetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(params.srcChainKey, params.newbnUSD);
      invariant(assetConfig, `hub asset not found for new bnUSD token: ${params.newbnUSD}`);
      decimals = assetConfig.decimals;
      calls.push(Erc20Service.encodeApprove(assetConfig.hubAsset, bnUSDVault, params.amount));
      calls.push(EvmVaultTokenService.encodeDeposit(bnUSDVault, assetConfig.hubAsset, params.amount));
    }

    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(decimals, params.amount);

    const dstAssetConfig = this.config.getSpokeTokenFromOriginalAssetAddress(params.dstChainKey, params.legacybnUSD);
    invariant(dstAssetConfig, `hub asset not found for new bnUSD token: ${params.legacybnUSD}`);

    calls.push(EvmVaultTokenService.encodeWithdraw(bnUSDVault, dstAssetConfig.vault, translatedAmount));
    calls.push(EvmVaultTokenService.encodeWithdraw(dstAssetConfig.vault, dstAssetConfig.hubAsset, translatedAmount));

    const translatedAmountOut = EvmVaultTokenService.translateOutgoingDecimals(
      dstAssetConfig.decimals,
      translatedAmount,
    );

    calls.push(
      EvmAssetManagerService.encodeTransfer(
        dstAssetConfig.hubAsset,
        params.dstAddress,
        translatedAmountOut,
        this.hubProvider.chainConfig.addresses.assetManager,
      ),
    );

    return encodeContractCalls(calls);
  }
}
