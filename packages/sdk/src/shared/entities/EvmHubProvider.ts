import { type PublicClient, createPublicClient } from 'viem';
import type { ConfigService } from '../config/ConfigService.js';

import { SonicSpokeService } from '../services/spoke/SonicSpokeService.js';
import { getIntentRelayChainId, type Address, type HubAddress, type HubConfig, type SpokeChainKey } from '@sodax/types';
import { getEvmViemChain } from '../utils/constant-utils.js';
import { buildEvmRpcTransport } from '../utils/transport-utils.js';
import { sonicWalletFactoryAbi } from '../abis/sonicWalletFactory.abi.js';
import { encodeAddress } from '../utils/shared-utils.js';
import { walletFactoryAbi } from '../abis/walletFactory.abi.js';

export type EvmHubProviderConstructorParams = {
  config: ConfigService;
};

type SrcAddressSpokeChainKeyPair = `${string}:${SpokeChainKey}`;
export class EvmHubProvider {
  public readonly publicClient: PublicClient;
  public readonly chainConfig: HubConfig;
  public readonly config: ConfigService;
  public readonly service: SonicSpokeService;
  public readonly hubAddressMap = new Map<SrcAddressSpokeChainKeyPair, Address>();

  constructor({ config }: EvmHubProviderConstructorParams) {
    this.publicClient = createPublicClient({
      transport: buildEvmRpcTransport(config.sodaxConfig.hub),
      chain: getEvmViemChain(config.sodaxConfig.hub.chain.key),
    });
    this.chainConfig = config.sodaxConfig.hub;
    this.config = config;
    this.service = new SonicSpokeService(this.config);
  }

  public async getUserHubWalletAddress(srcAddress: string, chainKey: SpokeChainKey): Promise<Address> {
    const key: SrcAddressSpokeChainKeyPair = `${srcAddress}:${chainKey}`;

    let hubWalletAddress = this.hubAddressMap.get(key);
    if (hubWalletAddress) {
      return hubWalletAddress;
    }

    hubWalletAddress = await this.fetchUserHubWalletAddress(srcAddress, chainKey);
    this.hubAddressMap.set(key, hubWalletAddress);

    return hubWalletAddress;
  }

  public async getUserRouter(address: Address): Promise<HubAddress> {
    return this.publicClient.readContract({
      address: this.chainConfig.addresses.walletRouter,
      abi: sonicWalletFactoryAbi,
      functionName: 'getDeployedAddress',
      args: [address],
    });
  }

  public async fetchUserHubWalletAddress(address: string, chainKey: SpokeChainKey): Promise<Address> {
    const encodedAddress = encodeAddress(chainKey, address);

    // Hub-chain users use the user router instead of the CREATE3 hub wallet.
    if (chainKey === this.chainConfig.chain.key) {
      return this.getUserRouter(encodedAddress);
    }

    return this.publicClient.readContract({
      address: this.chainConfig.addresses.hubWallet,
      abi: walletFactoryAbi,
      functionName: 'getDeployedAddress',
      args: [BigInt(getIntentRelayChainId(chainKey)), encodedAddress],
    });
  }
}
