import type { Address } from '@sodax/types';

export type PoolBaseCurrencyHumanized = {
  marketReferenceCurrencyDecimals: number;
  marketReferenceCurrencyPriceInUsd: string;
  networkBaseTokenPriceInUsd: string;
  networkBaseTokenPriceDecimals: number;
};

export type ReserveDataHumanized = {
  originalId: number;
  id: string;
  underlyingAsset: string;
  name: string;
  symbol: string;
  decimals: number;
  baseLTVasCollateral: string;
  reserveLiquidationThreshold: string;
  reserveLiquidationBonus: string;
  reserveFactor: string;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
  liquidityIndex: string;
  variableBorrowIndex: string;
  liquidityRate: string;
  variableBorrowRate: string;
  lastUpdateTimestamp: number;
  aTokenAddress: string;
  variableDebtTokenAddress: string;
  interestRateStrategyAddress: string;
  availableLiquidity: string;
  totalScaledVariableDebt: string;
  priceInMarketReferenceCurrency: string;
  priceOracle: string;
  variableRateSlope1: string;
  variableRateSlope2: string;
  baseVariableBorrowRate: string;
  optimalUsageRatio: string;
  isPaused: boolean;
  isSiloedBorrowing: boolean;
  accruedToTreasury: string;
  unbacked: string;
  isolationModeTotalDebt: string;
  flashLoanEnabled: boolean;
  debtCeiling: string;
  debtCeilingDecimals: number;
  borrowCap: string;
  supplyCap: string;
  borrowableInIsolation: boolean;
  virtualAccActive: boolean;
  virtualUnderlyingBalance: string;
};

export type UserReserveData = {
  underlyingAsset: string;
  scaledATokenBalance: bigint;
  usageAsCollateralEnabledOnUser: boolean;
  scaledVariableDebt: bigint;
};

export type BaseCurrencyInfo = {
  marketReferenceCurrencyUnit: bigint;
  marketReferenceCurrencyPriceInUsd: bigint;
  networkBaseTokenPriceInUsd: bigint;
  networkBaseTokenPriceDecimals: number;
};

export type AggregatedReserveData = {
  underlyingAsset: Address;
  name: string;
  symbol: string;
  decimals: bigint;
  baseLTVasCollateral: bigint;
  reserveLiquidationThreshold: bigint;
  reserveLiquidationBonus: bigint;
  reserveFactor: bigint;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  liquidityRate: bigint;
  variableBorrowRate: bigint;
  lastUpdateTimestamp: number;
  aTokenAddress: Address;
  variableDebtTokenAddress: Address;
  interestRateStrategyAddress: Address;
  availableLiquidity: bigint;
  totalScaledVariableDebt: bigint;
  priceInMarketReferenceCurrency: bigint;
  priceOracle: Address;
  variableRateSlope1: bigint;
  variableRateSlope2: bigint;
  baseVariableBorrowRate: bigint;
  optimalUsageRatio: bigint;
  isPaused: boolean;
  isSiloedBorrowing: boolean;
  accruedToTreasury: bigint;
  unbacked: bigint;
  isolationModeTotalDebt: bigint;
  flashLoanEnabled: boolean;
  debtCeiling: bigint;
  debtCeilingDecimals: bigint;
  borrowCap: bigint;
  supplyCap: bigint;
  borrowableInIsolation: boolean;
  virtualAccActive: boolean;
  virtualUnderlyingBalance: bigint;
};

export type ReservesDataHumanized = {
  reservesData: ReserveDataHumanized[];
  baseCurrencyData: PoolBaseCurrencyHumanized;
};

export type UserReserveDataHumanized = {
  id: string;
  underlyingAsset: string;
  scaledATokenBalance: string;
  usageAsCollateralEnabledOnUser: boolean;
  scaledVariableDebt: string;
};

export type EModeCategoryHumanized = {
  ltv: string;
  liquidationThreshold: string;
  liquidationBonus: string;
  collateralBitmap: string;
  label: string;
  borrowableBitmap: string;
};

export type EModeCategory = {
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
  collateralBitmap: bigint;
  label: string;
  borrowableBitmap: bigint;
};

export type EmodeDataHumanized = {
  id: number;
  eMode: EModeCategoryHumanized;
};

export type EModeData = {
  id: number;
  eMode: EModeCategory;
};

export type ReserveDataLegacy = {
  configuration: bigint;
  // ray
  liquidityIndex: bigint;
  // ray
  currentLiquidityRate: bigint;
  // ray
  variableBorrowIndex: bigint;
  // ray
  currentVariableBorrowRate: bigint;
  // DEPRECATED on v3.2.0
  currentStableBorrowRate: bigint;
  lastUpdateTimestamp: number;
  // position in the list of active reserves
  id: number;
  aTokenAddress: Address;
  // DEPRECATED on v3.2.0
  stableDebtTokenAddress: Address;
  variableDebtTokenAddress: Address;
  interestRateStrategyAddress: Address;
  // scaled
  accruedToTreasury: bigint;
  // unbacked aTokens minted through bridging
  unbacked: bigint;
  // debt borrowed against this asset in isolation mode
  isolationModeTotalDebt: bigint;
};

export interface UiPoolDataProviderInterface {
  getReservesList: () => Promise<readonly Address[]>;
  getReservesData: () => Promise<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]>;
  getUserReservesData: (userAddress: Address) => Promise<readonly [readonly UserReserveData[], number]>;
  getEModes: () => Promise<readonly EModeData[]>;
  getEModesHumanized: () => Promise<EmodeDataHumanized[]>;
  getReservesHumanized: () => Promise<ReservesDataHumanized>;
  getUserReservesHumanized: (userAddress: Address) => Promise<{
    userReserves: UserReserveDataHumanized[];
    userEmodeCategoryId: number;
  }>;
}
