import type { Address } from '@sodax/types';
import { uiPoolDataAbi } from '../shared/abis/uiPoolData.abi.js';
import type {
  AggregatedReserveData,
  BaseCurrencyInfo,
  EModeData,
  EmodeDataHumanized,
  PoolBaseCurrencyHumanized,
  ReserveDataHumanized,
  ReservesDataHumanized,
  UserReserveData,
  UserReserveDataHumanized,
  UiPoolDataProviderInterface,
} from './MoneyMarketTypes.js';
import { erc20BnusdAbi } from '../shared/abis/erc20-bnusd.abi.js';
import type { HubProvider } from '../shared/types/types.js';
import type { ConfigService } from '../shared/index.js';

export type UiPoolDataProviderServiceConstructorParams = {
  hubProvider: HubProvider;
  config: ConfigService;
};

/** Reads pool and user reserve state from the hub `UiPoolDataProvider`, merging the bnUSD debt and vault reserves. */
export class UiPoolDataProviderService implements UiPoolDataProviderInterface {
  private readonly hubProvider: HubProvider;
  private readonly uiPoolDataProvider: Address;
  private readonly poolAddressesProvider: Address;
  private readonly config: ConfigService;

  constructor({ hubProvider, config }: UiPoolDataProviderServiceConstructorParams) {
    this.hubProvider = hubProvider;
    this.uiPoolDataProvider = config.moneyMarket.uiPoolDataProvider;
    this.poolAddressesProvider = config.moneyMarket.poolAddressesProvider;
    this.config = config;
  }

  /** Each entry's `id` is a stable lowercased composite of chain key, user, reserve and addresses provider. */
  public async getUserReservesHumanized(userAddress: Address): Promise<{
    userReserves: UserReserveDataHumanized[];
    userEmodeCategoryId: number;
  }> {
    const [userReservesRaw, userEmodeCategoryId] = await this.getUserReservesData(userAddress);

    return {
      userReserves: userReservesRaw.map(userReserveRaw => ({
        id: `${this.hubProvider.chainConfig.chain.key}-${userAddress}-${userReserveRaw.underlyingAsset}-${this.poolAddressesProvider}`.toLowerCase(),
        underlyingAsset: userReserveRaw.underlyingAsset.toLowerCase(),
        scaledATokenBalance: userReserveRaw.scaledATokenBalance.toString(),
        usageAsCollateralEnabledOnUser: userReserveRaw.usageAsCollateralEnabledOnUser,
        scaledVariableDebt: userReserveRaw.scaledVariableDebt.toString(),
      })),
      userEmodeCategoryId,
    };
  }

  /** Bitmaps are serialized as 256-char zero-padded binary strings, MSB-first. */
  public async getEModesHumanized(): Promise<EmodeDataHumanized[]> {
    const eModeData = await this.getEModes();
    return eModeData.map(eMode => ({
      id: eMode.id,
      eMode: {
        ltv: eMode.eMode.ltv.toString(),
        liquidationThreshold: eMode.eMode.liquidationThreshold.toString(),
        liquidationBonus: eMode.eMode.liquidationBonus.toString(),
        collateralBitmap: eMode.eMode.collateralBitmap.toString(2).padStart(256, '0'),
        label: eMode.eMode.label,
        borrowableBitmap: eMode.eMode.borrowableBitmap.toString(2).padStart(256, '0'),
      },
    }));
  }

  public async getEModes(): Promise<readonly EModeData[]> {
    return this.hubProvider.publicClient.readContract({
      address: this.uiPoolDataProvider,
      abi: uiPoolDataAbi,
      functionName: 'getEModes',
      args: [this.poolAddressesProvider],
    });
  }
  /** Reserve assets, excluding the bnUSD debt reserve unless `unfiltered`. */
  public async getReservesList(unfiltered = false): Promise<readonly Address[]> {
    const reservesList = await this.hubProvider.publicClient.readContract({
      address: this.uiPoolDataProvider,
      abi: uiPoolDataAbi,
      functionName: 'getReservesList',
      args: [this.poolAddressesProvider],
    });

    if (unfiltered) {
      return reservesList;
    }

    return reservesList.filter(reserve => reserve.toLowerCase() !== this.config.moneyMarket.bnUSD.toLowerCase());
  }

  /** bnUSD facilitator bucket `[cap, currentBorrowed]`; overrides the bnUSD reserve's borrowCap and availableLiquidity. */
  public async getBnusdFacilitatorBucket(): Promise<readonly [bigint, bigint]> {
    return this.hubProvider.publicClient.readContract({
      address: this.config.moneyMarket.bnUSD,
      abi: erc20BnusdAbi,
      functionName: 'getFacilitatorBucket',
      args: [this.config.moneyMarket.bnUSDAToken],
    });
  }

  /**
   * bnUSD debt and vault reserves are merged: supply state from the vault, borrow rate/index/timestamp from
   * the debt token, and borrowCap/availableLiquidity from the facilitator bucket.
   */
  public async getReservesData(): Promise<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]> {
    const [reserveData, bnUSDFacilitatorBucket] = await Promise.all([
      this.hubProvider.publicClient.readContract({
        address: this.uiPoolDataProvider,
        abi: uiPoolDataAbi,
        functionName: 'getReservesData',
        args: [this.poolAddressesProvider],
      }),
      this.getBnusdFacilitatorBucket(),
    ]);

    const [cap, currentBorrowed] = bnUSDFacilitatorBucket;
    const reserves = reserveData[0];
    const baseCurrencyInfo = reserveData[1];
    const bnUSD = this.config.moneyMarket.bnUSD.toLowerCase();
    const bnUSDVault = this.config.moneyMarket.bnUSDVault.toLowerCase();

    const bnUSDReserve = reserves.find(r => bnUSD === r.underlyingAsset.toLowerCase());
    const bnUSDVaultReserve = reserves.find(r => bnUSDVault === r.underlyingAsset.toLowerCase());

    if (!bnUSDReserve || !bnUSDVaultReserve) {
      return reserveData;
    }

    const mergedBNUSDReserve = {
      ...bnUSDVaultReserve,
      borrowCap: cap,
      availableLiquidity: cap - currentBorrowed,
      totalScaledVariableDebt: bnUSDReserve.totalScaledVariableDebt + bnUSDVaultReserve.totalScaledVariableDebt,
      virtualUnderlyingBalance: bnUSDReserve.virtualUnderlyingBalance + bnUSDVaultReserve.virtualUnderlyingBalance,
      accruedToTreasury: bnUSDReserve.accruedToTreasury + bnUSDVaultReserve.accruedToTreasury,
      // The vault is the supply side; users actually borrow the bnUSD debt token.
      variableBorrowRate: bnUSDReserve.variableBorrowRate,
      // User debt is scaled by bnUSD's index; the vault's index would inflate displayed debt.
      variableBorrowIndex: bnUSDReserve.variableBorrowIndex,
      // The vault's (staler) timestamp would compound the debt index over too long a window and overstate debt;
      // the vault's liquidityRate is 0, so the supply side doesn't depend on it.
      lastUpdateTimestamp: bnUSDReserve.lastUpdateTimestamp,
      borrowingEnabled: bnUSDReserve.borrowingEnabled,
    };

    return [
      [
        mergedBNUSDReserve,
        ...reserves.filter(
          r => r.underlyingAsset.toLowerCase() !== bnUSD && r.underlyingAsset.toLowerCase() !== bnUSDVault,
        ),
      ],
      baseCurrencyInfo,
    ];
  }

  /** bnUSD debt and vault reserves are merged (scaled balances summed); eMode category 0 means none. */
  public async getUserReservesData(userAddress: Address): Promise<readonly [readonly UserReserveData[], number]> {
    const userReserves = await this.hubProvider.publicClient.readContract({
      address: this.uiPoolDataProvider,
      abi: uiPoolDataAbi,
      functionName: 'getUserReservesData',
      args: [this.poolAddressesProvider, userAddress],
    });

    const userReservesData = userReserves[0];
    const eModeCategoryId = userReserves[1];
    const bnUSD = this.config.moneyMarket.bnUSD.toLowerCase();
    const bnUSDVault = this.config.moneyMarket.bnUSDVault.toLowerCase();

    const bnUSDReserve = userReservesData.find(r => bnUSD === r.underlyingAsset.toLowerCase());
    const bnUSDVaultReserve = userReservesData.find(r => bnUSDVault === r.underlyingAsset.toLowerCase());

    if (!bnUSDReserve || !bnUSDVaultReserve) {
      return userReserves;
    }

    const mergedBNUSDReserve = {
      ...bnUSDVaultReserve,
      scaledATokenBalance: bnUSDReserve.scaledATokenBalance + bnUSDVaultReserve.scaledATokenBalance,
      scaledVariableDebt: bnUSDReserve.scaledVariableDebt + bnUSDVaultReserve.scaledVariableDebt,
    };

    return [
      [
        mergedBNUSDReserve,
        ...userReservesData.filter(
          r => r.underlyingAsset.toLowerCase() !== bnUSD && r.underlyingAsset.toLowerCase() !== bnUSDVault,
        ),
      ],
      eModeCategoryId,
    ];
  }

  /** Each reserve's `id` is a stable lowercased composite of chain key, reserve and addresses provider. */
  public async getReservesHumanized(): Promise<ReservesDataHumanized> {
    const [reservesRaw, poolBaseCurrencyRaw] = await this.getReservesData();

    const reservesData: ReserveDataHumanized[] = reservesRaw.map((reserveRaw, index) => {
      const virtualUnderlyingBalance = reserveRaw.virtualUnderlyingBalance.toString();
      const { virtualAccActive } = reserveRaw;
      return {
        originalId: index,
        id: `${this.hubProvider.chainConfig.chain.key}-${reserveRaw.underlyingAsset}-${this.poolAddressesProvider}`.toLowerCase(),
        underlyingAsset: reserveRaw.underlyingAsset.toLowerCase(),
        name: reserveRaw.name,
        symbol: reserveRaw.symbol,
        decimals: Number(reserveRaw.decimals),
        baseLTVasCollateral: reserveRaw.baseLTVasCollateral.toString(),
        reserveLiquidationThreshold: reserveRaw.reserveLiquidationThreshold.toString(),
        reserveLiquidationBonus: reserveRaw.reserveLiquidationBonus.toString(),
        reserveFactor: reserveRaw.reserveFactor.toString(),
        usageAsCollateralEnabled: reserveRaw.usageAsCollateralEnabled,
        borrowingEnabled: reserveRaw.borrowingEnabled,
        isActive: reserveRaw.isActive,
        isFrozen: reserveRaw.isFrozen,
        liquidityIndex: reserveRaw.liquidityIndex.toString(),
        variableBorrowIndex: reserveRaw.variableBorrowIndex.toString(),
        liquidityRate: reserveRaw.liquidityRate.toString(),
        variableBorrowRate: reserveRaw.variableBorrowRate.toString(),
        lastUpdateTimestamp: reserveRaw.lastUpdateTimestamp,
        aTokenAddress: reserveRaw.aTokenAddress.toString(),
        variableDebtTokenAddress: reserveRaw.variableDebtTokenAddress.toString(),
        interestRateStrategyAddress: reserveRaw.interestRateStrategyAddress.toString(),
        availableLiquidity: reserveRaw.availableLiquidity.toString(),
        totalScaledVariableDebt: reserveRaw.totalScaledVariableDebt.toString(),
        priceInMarketReferenceCurrency: reserveRaw.priceInMarketReferenceCurrency.toString(),
        priceOracle: reserveRaw.priceOracle,
        variableRateSlope1: reserveRaw.variableRateSlope1.toString(),
        variableRateSlope2: reserveRaw.variableRateSlope2.toString(),
        baseVariableBorrowRate: reserveRaw.baseVariableBorrowRate.toString(),
        optimalUsageRatio: reserveRaw.optimalUsageRatio.toString(),
        isPaused: reserveRaw.isPaused,
        debtCeiling: reserveRaw.debtCeiling.toString(),
        borrowCap: reserveRaw.borrowCap.toString(),
        supplyCap: reserveRaw.supplyCap.toString(),
        borrowableInIsolation: reserveRaw.borrowableInIsolation,
        accruedToTreasury: reserveRaw.accruedToTreasury.toString(),
        unbacked: reserveRaw.unbacked.toString(),
        isolationModeTotalDebt: reserveRaw.isolationModeTotalDebt.toString(),
        debtCeilingDecimals: Number(reserveRaw.debtCeilingDecimals),
        isSiloedBorrowing: reserveRaw.isSiloedBorrowing,
        flashLoanEnabled: reserveRaw.flashLoanEnabled,
        virtualAccActive,
        virtualUnderlyingBalance,
      };
    });

    const baseCurrencyData: PoolBaseCurrencyHumanized = {
      // 1e18 → "1000000000000000000".length - 1 = 18 decimals
      marketReferenceCurrencyDecimals: poolBaseCurrencyRaw.marketReferenceCurrencyUnit.toString().length - 1,
      marketReferenceCurrencyPriceInUsd: poolBaseCurrencyRaw.marketReferenceCurrencyPriceInUsd.toString(),
      networkBaseTokenPriceInUsd: poolBaseCurrencyRaw.networkBaseTokenPriceInUsd.toString(),
      networkBaseTokenPriceDecimals: poolBaseCurrencyRaw.networkBaseTokenPriceDecimals,
    };

    return {
      reservesData,
      baseCurrencyData,
    };
  }
}
