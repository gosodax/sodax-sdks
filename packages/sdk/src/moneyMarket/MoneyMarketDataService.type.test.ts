/** Pins the money market read and formatting surface; `formatReservesUSD` carries the caller's reserve type. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  Address,
  AggregatedReserveData,
  BaseCurrencyInfo,
  EModeData,
  EmodeDataHumanized,
  Erc20Token,
  FormatReserveUSDResponse,
  FormatReservesUSDRequest,
  FormatUserSummaryRequest,
  FormatUserSummaryResponse,
  ReserveDataHumanized,
  ReserveDataLegacy,
  ReserveDataWithPrice,
  ReservesDataHumanized,
  UserReserveData,
  UserReserveDataHumanized,
} from '../index.js';
import type { MoneyMarketDataService, formatBasisPoints, formatPercentage } from './MoneyMarketDataService.js';

type Svc = MoneyMarketDataService;
type TaggedReserve = ReserveDataWithPrice & { tag: 'extra' };

declare const data: MoneyMarketDataService;
declare const plainRequest: FormatReservesUSDRequest<ReserveDataWithPrice>;
declare const taggedRequest: FormatReservesUSDRequest<TaggedReserve>;

// Never invoked: `data` exists only at the type level.
const formatPlain = () => data.formatReservesUSD(plainRequest);
const formatTagged = () => data.formatReservesUSD(taggedRequest);

describe('MoneyMarketDataService', () => {
  it('token and reserve reads', () => {
    expectTypeOf<ReturnType<Svc['getATokenData']>>().toEqualTypeOf<Promise<Erc20Token>>();
    expectTypeOf<ReturnType<Svc['getATokensBalances']>>().toEqualTypeOf<Promise<Map<Address, bigint>>>();
    expectTypeOf<ReturnType<Svc['getReserveNormalizedIncome']>>().toEqualTypeOf<Promise<bigint>>();
    expectTypeOf<ReturnType<Svc['getReserveData']>>().toEqualTypeOf<Promise<ReserveDataLegacy>>();
    expectTypeOf<ReturnType<Svc['getReservesList']>>().toEqualTypeOf<Promise<readonly Address[]>>();
  });

  it('raw pool data reads keep the contract tuple shapes', () => {
    expectTypeOf<ReturnType<Svc['getReservesData']>>().toEqualTypeOf<
      Promise<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]>
    >();
    expectTypeOf<ReturnType<Svc['getUserReservesData']>>().toEqualTypeOf<
      Promise<readonly [readonly UserReserveData[], number]>
    >();
    expectTypeOf<ReturnType<Svc['getEModes']>>().toEqualTypeOf<Promise<readonly EModeData[]>>();
  });

  it('humanized reads', () => {
    expectTypeOf<ReturnType<Svc['getEModesHumanized']>>().toEqualTypeOf<Promise<EmodeDataHumanized[]>>();
    expectTypeOf<ReturnType<Svc['getReservesHumanized']>>().toEqualTypeOf<Promise<ReservesDataHumanized>>();
    expectTypeOf<ReturnType<Svc['getUserReservesHumanized']>>().toEqualTypeOf<
      Promise<{ userReserves: UserReserveDataHumanized[]; userEmodeCategoryId: number }>
    >();
  });

  it('request builders', () => {
    expectTypeOf<ReturnType<Svc['buildReserveDataWithPrice']>>().toEqualTypeOf<
      FormatReservesUSDRequest<ReserveDataHumanized>
    >();
    expectTypeOf<ReturnType<Svc['buildUserSummaryRequest']>>().toEqualTypeOf<
      FormatUserSummaryRequest<FormatReserveUSDResponse>
    >();
  });

  it('formatReservesUSD keeps the caller reserve type', () => {
    expectTypeOf<ReturnType<typeof formatPlain>>().toEqualTypeOf<
      Array<ReserveDataWithPrice & FormatReserveUSDResponse>
    >();
    expectTypeOf<ReturnType<typeof formatTagged>>().toEqualTypeOf<Array<TaggedReserve & FormatReserveUSDResponse>>();
  });

  it('single reserve and user summary formatters', () => {
    expectTypeOf<ReturnType<Svc['formatReserveUSD']>>().toEqualTypeOf<FormatReserveUSDResponse>();
    expectTypeOf<ReturnType<Svc['formatUserSummary']>>().toEqualTypeOf<
      FormatUserSummaryResponse<FormatReserveUSDResponse>
    >();
  });

  it('formatPercentage and formatBasisPoints return decimal strings', () => {
    expectTypeOf<ReturnType<typeof formatPercentage>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof formatBasisPoints>>().toEqualTypeOf<string>();
  });
});
