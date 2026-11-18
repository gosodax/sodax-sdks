/** Pins the result types of the UI pool data provider reads, raw and humanized. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  Address,
  AggregatedReserveData,
  BaseCurrencyInfo,
  EModeData,
  EmodeDataHumanized,
  ReservesDataHumanized,
  UserReserveData,
  UserReserveDataHumanized,
} from '../index.js';
import type { UiPoolDataProviderService } from './UiPoolDataProviderService.js';

type Svc = UiPoolDataProviderService;

describe('UiPoolDataProviderService', () => {
  it('raw reads keep the contract tuple shapes', () => {
    expectTypeOf<ReturnType<Svc['getReservesList']>>().toEqualTypeOf<Promise<readonly Address[]>>();
    expectTypeOf<ReturnType<Svc['getEModes']>>().toEqualTypeOf<Promise<readonly EModeData[]>>();
    expectTypeOf<ReturnType<Svc['getBnusdFacilitatorBucket']>>().toEqualTypeOf<Promise<readonly [bigint, bigint]>>();
    expectTypeOf<ReturnType<Svc['getReservesData']>>().toEqualTypeOf<
      Promise<readonly [readonly AggregatedReserveData[], BaseCurrencyInfo]>
    >();
    expectTypeOf<ReturnType<Svc['getUserReservesData']>>().toEqualTypeOf<
      Promise<readonly [readonly UserReserveData[], number]>
    >();
  });

  it('humanized reads return the humanized shapes', () => {
    expectTypeOf<ReturnType<Svc['getEModesHumanized']>>().toEqualTypeOf<Promise<EmodeDataHumanized[]>>();
    expectTypeOf<ReturnType<Svc['getReservesHumanized']>>().toEqualTypeOf<Promise<ReservesDataHumanized>>();
    expectTypeOf<ReturnType<Svc['getUserReservesHumanized']>>().toEqualTypeOf<
      Promise<{ userReserves: UserReserveDataHumanized[]; userEmodeCategoryId: number }>
    >();
  });
});
