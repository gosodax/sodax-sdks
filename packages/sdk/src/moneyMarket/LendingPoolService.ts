import type { Address } from '@sodax/types';
import { poolAbi } from '../shared/abis/pool.abi.js';
import type { ReserveDataLegacy } from './MoneyMarketTypes.js';
import type { HubProvider } from '../shared/types/types.js';
import type { ConfigService } from '../shared/index.js';

export type LendingPoolServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
};

export class LendingPoolService {
  private readonly hubProvider: HubProvider;
  private readonly lendingPool: Address;

  constructor({ hubProvider, config }: LendingPoolServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.lendingPool = config.moneyMarket.lendingPool;
  }

  async getReservesList(): Promise<readonly Address[]> {
    return this.hubProvider.publicClient.readContract({
      address: this.lendingPool,
      abi: poolAbi,
      functionName: 'getReservesList',
      args: [],
    });
  }

  async getReserveData(assetAddress: Address): Promise<ReserveDataLegacy> {
    return this.hubProvider.publicClient.readContract({
      address: this.lendingPool,
      abi: poolAbi,
      functionName: 'getReserveData',
      args: [assetAddress],
    });
  }

  async getReserveNormalizedIncome(asset: Address): Promise<bigint> {
    return this.hubProvider.publicClient.readContract({
      address: this.lendingPool,
      abi: poolAbi,
      functionName: 'getReserveNormalizedIncome',
      args: [asset],
    });
  }
}
