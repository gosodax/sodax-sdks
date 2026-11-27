import type {
  AggregatedReserveData,
  BaseCurrencyInfo,
  EModeData,
  EmodeDataHumanized,
  ReservesDataHumanized,
  UserReserveData,
  UserReserveDataHumanized,
  ReserveDataLegacy,
  ReserveDataHumanized,
} from './MoneyMarketTypes.js';
import {
  formatReserves,
  formatReserveUSD,
  formatUserSummary,
  type FormatReservesUSDRequest,
  type FormatReserveUSDRequest,
  type FormatReserveUSDResponse,
  type FormatUserSummaryRequest,
  type FormatUserSummaryResponse,
  type ReserveData,
  type ReserveDataWithPrice,
} from './math-utils/index.js';
import { UiPoolDataProviderService } from './UiPoolDataProviderService.js';
import { LendingPoolService } from './LendingPoolService.js';
import type { Address, SpokeChainKey } from '@sodax/types';
import { Erc20Service, type Erc20Token, type HubProvider } from '../shared/index.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import { erc20Abi } from 'viem';

export type MoneyMarketDataServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
};

/** Read-only money market data and USD formatting; exposed as `MoneyMarketService.data`. */
export class MoneyMarketDataService {
  public readonly uiPoolDataProviderService: UiPoolDataProviderService;
  public readonly lendingPoolService: LendingPoolService;
  public readonly hubProvider: HubProvider;
  public readonly config: ConfigService;

  constructor({ hubProvider, config }: MoneyMarketDataServiceConstructorParams) {
    this.config = config;
    this.hubProvider = hubProvider;
    this.uiPoolDataProviderService = new UiPoolDataProviderService({ hubProvider, config });
    this.lendingPoolService = new LendingPoolService({ hubProvider, config });
  }

  public async getATokenData(aToken: Address): Promise<Erc20Token> {
    return Erc20Service.getErc20Token(aToken, this.hubProvider.publicClient);
  }

  /**
   * Raw aToken balances of a hub wallet, fetched in one multicall.
   * @namespace SodaxPublicUtils
   */
  public async getATokensBalances(aTokens: readonly Address[], userAddress: Address): Promise<Map<Address, bigint>> {
    const contracts = aTokens.map((aToken: Address) => ({
      address: aToken,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [userAddress] as const,
    }));

    const results = await this.hubProvider.publicClient.multicall({
      contracts,
      allowFailure: false,
    });

    const balanceMap = new Map<Address, bigint>();
    let resultIndex = 0;
    for (const aToken of aTokens) {
      const result = results[resultIndex];
      if (result !== undefined) {
        balanceMap.set(aToken, result as bigint);
      }
      resultIndex++;
    }

    return balanceMap;
  }

  /** Current liquidity index in RAY (1e27). */
  public async getReserveNormalizedIncome(asset: Address): Promise<bigint> {
    return this.lendingPoolService.getReserveNormalizedIncome(asset);
  }

  /** Raw reserve data: rates in RAY, timestamps in Unix seconds. */
  public async getReserveData(asset: Address): Promise<ReserveDataLegacy> {
    return this.lendingPoolService.getReserveData(asset);
  }

  /** Reserve assets, excluding the bnUSD debt reserve unless `unfiltered`. */
  public async getReservesList(unfiltered = false): Promise<readonly Address[]> {
    return this.uiPoolDataProviderService.getReservesList(unfiltered);
  }

  /** Raw reserves, with the bnUSD debt and vault reserves merged so borrow state matches what the pool enforces. */
  public async getReservesData(): Promise<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]> {
    return this.uiPoolDataProviderService.getReservesData();
  }

  /** Raw user positions via the derived hub wallet; bnUSD debt and vault reserves are merged (balances summed). */
  public async getUserReservesData(
    spokeChainId: SpokeChainKey,
    userAddress: string,
  ): Promise<readonly [readonly UserReserveData[], number]> {
    const hubWalletAddress = await this.hubProvider.getUserHubWalletAddress(userAddress, spokeChainId);

    return this.uiPoolDataProviderService.getUserReservesData(hubWalletAddress);
  }

  public async getEModes(): Promise<readonly EModeData[]> {
    return this.uiPoolDataProviderService.getEModes();
  }

  /** Bitmaps are serialized as 256-char binary strings, MSB-first. */
  public async getEModesHumanized(): Promise<EmodeDataHumanized[]> {
    return this.uiPoolDataProviderService.getEModesHumanized();
  }

  /** Base currency unit is normalized to a decimal count (1e18 → 18); output feeds {@link formatReservesUSD}. */
  public async getReservesHumanized(): Promise<ReservesDataHumanized> {
    return this.uiPoolDataProviderService.getReservesHumanized();
  }

  public async getUserReservesHumanized(
    spokeChainId: SpokeChainKey,
    userAddress: string,
  ): Promise<{
    userReserves: UserReserveDataHumanized[];
    userEmodeCategoryId: number;
  }> {
    const hubWalletAddress = await this.hubProvider.getUserHubWalletAddress(userAddress, spokeChainId);

    return this.uiPoolDataProviderService.getUserReservesHumanized(hubWalletAddress);
  }

  public buildReserveDataWithPrice(reserves: ReservesDataHumanized): FormatReservesUSDRequest<ReserveDataHumanized> {
    const currentUnixTimestamp: number = Math.floor(Date.now() / 1000);

    // Surface clock skew: only reserves whose lastUpdateTimestamp is ahead of the client clock
    // get their interest accrual clamped to 0, so report the affected count rather than implying all.
    const skewedReserves = reserves.reservesData.filter(r => r.lastUpdateTimestamp > currentUnixTimestamp);
    if (skewedReserves.length > 0) {
      this.config.logger.warn(
        `[moneyMarket] client clock ${currentUnixTimestamp}s is behind chain block time; accrual clamped to 0 for ${skewedReserves.length} affected reserve(s)`,
      );
    }

    const baseCurrencyData = reserves.baseCurrencyData;

    return {
      reserves: reserves.reservesData,
      currentTimestamp: currentUnixTimestamp,
      marketReferenceCurrencyDecimals: baseCurrencyData.marketReferenceCurrencyDecimals,
      marketReferencePriceInUsd: baseCurrencyData.marketReferenceCurrencyPriceInUsd,
    };
  }

  public buildUserSummaryRequest(
    reserves: ReservesDataHumanized,
    formattedReserves: (ReserveData & { priceInMarketReferenceCurrency: string } & FormatReserveUSDResponse)[],
    userReserves: {
      userReserves: UserReserveDataHumanized[];
      userEmodeCategoryId: number;
    },
  ): FormatUserSummaryRequest<FormatReserveUSDResponse> {
    const currentUnixTimestamp: number = Math.floor(Date.now() / 1000);
    const baseCurrencyData = reserves.baseCurrencyData;
    const userReservesArray = userReserves.userReserves;

    return {
      currentTimestamp: currentUnixTimestamp,
      marketReferenceCurrencyDecimals: baseCurrencyData.marketReferenceCurrencyDecimals,
      marketReferencePriceInUsd: baseCurrencyData.marketReferenceCurrencyPriceInUsd,
      userReserves: userReservesArray,
      formattedReserves,
      userEmodeCategoryId: userReserves.userEmodeCategoryId,
    };
  }

  public formatReservesUSD<T extends ReserveDataWithPrice>(
    params: FormatReservesUSDRequest<T>,
  ): Array<T & FormatReserveUSDResponse> {
    return formatReserves<T>(params);
  }

  public formatReserveUSD(params: FormatReserveUSDRequest): FormatReserveUSDResponse {
    return formatReserveUSD(params);
  }

  public formatUserSummary(
    params: FormatUserSummaryRequest<FormatReserveUSDResponse>,
  ): FormatUserSummaryResponse<FormatReserveUSDResponse> {
    return formatUserSummary(params);
  }
}

/** Formats a `10^decimals`-precision value (RAY by default) as e.g. `"4.56%"`. */
export function formatPercentage(value: bigint, decimals = 27): string {
  return `${(Number(value) / 10 ** decimals).toFixed(2)}%`;
}

/** Formats basis points (`500n` = 5%) as e.g. `"5.00%"`. */
export function formatBasisPoints(value: bigint): string {
  return `${(Number(value) / 100).toFixed(2)}%`;
}
