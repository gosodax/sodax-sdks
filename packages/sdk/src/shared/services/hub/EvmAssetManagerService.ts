import { type Address, type Hex, type PublicClient, encodeFunctionData } from 'viem';
import { assetManagerAbi } from '../../abis/index.js';
import { encodeContractCalls } from '../../utils/evm-utils.js';
import { EvmVaultTokenService } from './EvmVaultTokenService.js';
import type { SpokeChainKey, AssetInfo, EvmContractCall } from '@sodax/types';
import type { ConfigService } from '../../config/ConfigService.js';
import { Erc20Service } from '../erc-20/index.js';
import type { EvmHubProvider } from '../../entities/EvmHubProvider.js';

export type EvmDepositToDataParams = {
  token: Address;
  to: Address;
  amount: bigint;
};

export type EvmWithdrawAssetDataParams = {
  token: Hex | string;
  to: Hex; // since spoke chain can  be non-evm as well
  amount: bigint;
};

export class EvmAssetManagerService {
  private constructor() {}

  public static async getAssetInfo(asset: Address, assetManager: Address, client: PublicClient): Promise<AssetInfo> {
    const [chainId, spokeAddress] = await client.readContract({
      address: assetManager,
      abi: assetManagerAbi,
      functionName: 'assetInfo',
      args: [asset],
    });

    return {
      chainId,
      spokeAddress,
    };
  }

  /** `to` is the hex-encoded recipient from `encodeRecipient`. */
  public static encodeTransfer(token: Address, to: Hex, amount: bigint, assetManager: Address): EvmContractCall {
    return {
      address: assetManager,
      value: 0n,
      data: encodeFunctionData({
        abi: assetManagerAbi,
        functionName: 'transfer',
        args: [token, to, amount, '0x'],
      }),
    };
  }

  /** Hub calls that approve, vault-deposit and transfer the vault tokens to `params.to`. */
  public static depositToData(
    params: EvmDepositToDataParams,
    spokeChainId: SpokeChainKey,
    configService: ConfigService,
  ): Hex {
    const calls: EvmContractCall[] = [];
    const assetConfig = configService.getSpokeTokenFromOriginalAssetAddress(spokeChainId, params.token);

    if (!assetConfig) {
      throw new Error(`[depositToData] Hub asset not found for token: ${params.token}`);
    }

    const assetAddress = assetConfig.hubAsset;
    const vaultAddress = assetConfig.vault;

    calls.push(Erc20Service.encodeApprove(assetAddress, vaultAddress, params.amount));
    calls.push(EvmVaultTokenService.encodeDeposit(vaultAddress, assetAddress, params.amount));
    const translatedAmount = EvmVaultTokenService.translateIncomingDecimals(assetConfig.decimals, params.amount);
    calls.push(Erc20Service.encodeTransfer(vaultAddress, params.to, translatedAmount));

    return encodeContractCalls(calls);
  }

  /** Does not validate the payout floor: for MPC-relay destinations, validate amount and token before signing. */
  public static withdrawAssetData(
    params: EvmWithdrawAssetDataParams,
    hubProvider: EvmHubProvider,
    spokeChainId: SpokeChainKey,
  ): Hex {
    const calls: EvmContractCall[] = [];
    const assetConfig = hubProvider.config.getSpokeTokenFromOriginalAssetAddress(spokeChainId, params.token);

    if (!assetConfig) {
      throw new Error(`[withdrawAssetData] Hub asset not found for token: ${params.token}`);
    }

    const assetAddress = assetConfig.hubAsset;

    calls.push(
      EvmAssetManagerService.encodeTransfer(
        assetAddress,
        params.to,
        params.amount,
        hubProvider.chainConfig.addresses.assetManager,
      ),
    );

    return encodeContractCalls(calls);
  }

  async getAssetAddress(
    chainId: bigint,
    spokeAddress: Address,
    assetManager: Address,
    client: PublicClient,
  ): Promise<Address> {
    return client.readContract({
      address: assetManager,
      abi: assetManagerAbi,
      functionName: 'assets',
      args: [chainId, spokeAddress],
    });
  }
}
