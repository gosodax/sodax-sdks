import { describe, expect, it, vi } from 'vitest';
import type { Address } from '@sodax/types';
import { UiPoolDataProviderService } from './UiPoolDataProviderService.js';
import type { AggregatedReserveData, BaseCurrencyInfo } from './MoneyMarketTypes.js';

// Addresses used by the merge special-case.
const BNUSD_DEBT = '0x94dc79ce9c515ba4ae4d195da8e6ab86c69bfc38' as Address; // config.moneyMarket.bnUSD (debt token)
const BNUSD_VAULT = '0xe801ca34e19abcbfea12025378d19c4fbe250131' as Address; // config.moneyMarket.bnUSDVault
const BNUSD_ATOKEN = '0x0000000000000000000000000000000000000a70' as Address;
const UI_POOL = '0x0000000000000000000000000000000000000001' as Address;
const ADDR_PROVIDER = '0x0000000000000000000000000000000000000002' as Address;

// Full, type-safe raw reserve fixture (all bigint contract-native fields).
const BASE_RESERVE: AggregatedReserveData = {
  underlyingAsset: '0x0000000000000000000000000000000000000000' as Address,
  name: 'Test',
  symbol: 'TST',
  decimals: 18n,
  baseLTVasCollateral: 0n,
  reserveLiquidationThreshold: 0n,
  reserveLiquidationBonus: 0n,
  reserveFactor: 0n,
  usageAsCollateralEnabled: false,
  borrowingEnabled: false,
  isActive: true,
  isFrozen: false,
  liquidityIndex: 1_000_000_000_000_000_000_000_000_000n,
  variableBorrowIndex: 1_000_000_000_000_000_000_000_000_000n,
  liquidityRate: 0n,
  variableBorrowRate: 0n,
  lastUpdateTimestamp: 0,
  aTokenAddress: '0x0000000000000000000000000000000000000000' as Address,
  variableDebtTokenAddress: '0x0000000000000000000000000000000000000000' as Address,
  interestRateStrategyAddress: '0x0000000000000000000000000000000000000000' as Address,
  availableLiquidity: 0n,
  totalScaledVariableDebt: 0n,
  priceInMarketReferenceCurrency: 0n,
  priceOracle: '0x0000000000000000000000000000000000000000' as Address,
  variableRateSlope1: 0n,
  variableRateSlope2: 0n,
  baseVariableBorrowRate: 0n,
  optimalUsageRatio: 0n,
  isPaused: false,
  isSiloedBorrowing: false,
  accruedToTreasury: 0n,
  unbacked: 0n,
  isolationModeTotalDebt: 0n,
  flashLoanEnabled: false,
  debtCeiling: 0n,
  debtCeilingDecimals: 0n,
  borrowCap: 0n,
  supplyCap: 0n,
  borrowableInIsolation: false,
  virtualAccActive: false,
  virtualUnderlyingBalance: 0n,
};

const baseCurrencyInfo = {
  marketReferenceCurrencyUnit: 100_000_000n,
  marketReferenceCurrencyPriceInUsd: 100_000_000n,
  networkBaseTokenPriceInUsd: 0n,
  networkBaseTokenPriceDecimals: 8,
} as unknown as BaseCurrencyInfo;

// The bnUSD debt reserve: fresh timestamp, its own borrow index/rate.
const DEBT_RESERVE: AggregatedReserveData = {
  ...BASE_RESERVE,
  underlyingAsset: BNUSD_DEBT,
  symbol: 'bnUSDd',
  variableBorrowIndex: 1_024_731_073_935_052_317_889_508_298n,
  variableBorrowRate: 20_000_000_000_000_000_000_000_000n, // 2%
  totalScaledVariableDebt: 100n,
  lastUpdateTimestamp: 2_000, // recent
};

// The bnUSD vault (supply side): STALE timestamp, liquidityRate 0, unrelated borrow fields.
const VAULT_RESERVE: AggregatedReserveData = {
  ...BASE_RESERVE,
  underlyingAsset: BNUSD_VAULT,
  symbol: 'bnUSD',
  variableBorrowIndex: 1_110_824_300_758_873_242_271_674_232n,
  variableBorrowRate: 2_500_000_000_000_000_000_000_000n,
  liquidityRate: 0n,
  totalScaledVariableDebt: 0n,
  lastUpdateTimestamp: 1_000, // ~stale relative to the debt reserve
};

function makeService(): UiPoolDataProviderService {
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    if (functionName === 'getReservesData') {
      return [[VAULT_RESERVE, DEBT_RESERVE], baseCurrencyInfo] as const;
    }
    if (functionName === 'getFacilitatorBucket') {
      return [1_000_000n, 250_000n] as const; // [cap, currentBorrowed]
    }
    throw new Error(`unexpected functionName ${functionName}`);
  });

  const hubProvider = { publicClient: { readContract } } as unknown as ConstructorParameters<
    typeof UiPoolDataProviderService
  >[0]['hubProvider'];

  const config = {
    moneyMarket: {
      uiPoolDataProvider: UI_POOL,
      poolAddressesProvider: ADDR_PROVIDER,
      bnUSD: BNUSD_DEBT,
      bnUSDVault: BNUSD_VAULT,
      bnUSDAToken: BNUSD_ATOKEN,
    },
  } as unknown as ConstructorParameters<typeof UiPoolDataProviderService>[0]['config'];

  return new UiPoolDataProviderService({ hubProvider, config });
}

describe('UiPoolDataProviderService.getReservesData — bnUSD merge', () => {
  it('collapses the two bnUSD reserves into one entry pinned to the debt token’s (index, rate, lastUpdateTimestamp)', async () => {
    const service = makeService();
    const [reserves] = await service.getReservesData();
    const bnUSDEntries = reserves.filter(
      r =>
        r.underlyingAsset.toLowerCase() === BNUSD_DEBT.toLowerCase() ||
        r.underlyingAsset.toLowerCase() === BNUSD_VAULT.toLowerCase(),
    );
    expect(bnUSDEntries).toHaveLength(1);
    const merged = reserves.find(r => r.underlyingAsset.toLowerCase() === BNUSD_VAULT.toLowerCase());

    expect(merged).toBeDefined();
    // Borrow index & rate come from the debt token (existing behaviour)…
    expect(merged?.variableBorrowIndex).toBe(DEBT_RESERVE.variableBorrowIndex);
    expect(merged?.variableBorrowRate).toBe(DEBT_RESERVE.variableBorrowRate);
    // …and — the regression — so must the timestamp they are accrued from. Inheriting the vault's
    // stale timestamp compounds the debt index over the wrong window and inflates displayed debt.
    expect(merged?.lastUpdateTimestamp).toBe(DEBT_RESERVE.lastUpdateTimestamp);
    expect(merged?.lastUpdateTimestamp).not.toBe(VAULT_RESERVE.lastUpdateTimestamp);
  });
});
