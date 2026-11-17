/** Pins the reserve formatters; the plural formatters carry the caller's reserve type through to the result. */
import { describe, expectTypeOf, it } from 'vitest';
import type { CalculateReserveIncentivesResponse } from '../incentive/calculate-reserve-incentives.js';
import type { ReservesIncentiveDataHumanized } from '../incentive/types.js';
import {
  type FormatReserveResponse,
  type FormatReserveUSDResponse,
  type ReserveDataWithPrice,
  type formatReserve,
  type formatReserveUSD,
  formatReserves,
  formatReservesAndIncentives,
} from './index.js';

type TaggedReserve = ReserveDataWithPrice & { tag: 'extra' };

declare const plain: ReserveDataWithPrice[];
declare const tagged: TaggedReserve[];
declare const incentives: ReservesIncentiveDataHumanized[];
const usd = { currentTimestamp: 0, marketReferencePriceInUsd: '1', marketReferenceCurrencyDecimals: 8 };

// Never invoked: the declared reserves exist only at the type level.
const formatPlain = () => formatReserves({ reserves: plain, ...usd });
const formatTagged = () => formatReserves({ reserves: tagged, ...usd });
const incentivesPlain = () => formatReservesAndIncentives({ reserves: plain, reserveIncentives: incentives, ...usd });
const incentivesTagged = () => formatReservesAndIncentives({ reserves: tagged, reserveIncentives: incentives, ...usd });

describe('reserve formatters', () => {
  it('formatReserve and formatReserveUSD return the formatted reserve', () => {
    expectTypeOf<ReturnType<typeof formatReserve>>().toEqualTypeOf<FormatReserveResponse>();
    expectTypeOf<ReturnType<typeof formatReserveUSD>>().toEqualTypeOf<FormatReserveUSDResponse>();
  });

  it('formatReserves keeps the caller reserve type', () => {
    expectTypeOf<ReturnType<typeof formatPlain>>().toEqualTypeOf<
      Array<ReserveDataWithPrice & FormatReserveUSDResponse>
    >();
    expectTypeOf<ReturnType<typeof formatTagged>>().toEqualTypeOf<Array<TaggedReserve & FormatReserveUSDResponse>>();
  });

  it('formatReservesAndIncentives keeps the caller reserve type and adds optional incentives', () => {
    expectTypeOf<ReturnType<typeof incentivesPlain>>().toEqualTypeOf<
      Array<FormatReserveUSDResponse & ReserveDataWithPrice & Partial<CalculateReserveIncentivesResponse>>
    >();
    expectTypeOf<ReturnType<typeof incentivesTagged>>().toEqualTypeOf<
      Array<FormatReserveUSDResponse & TaggedReserve & Partial<CalculateReserveIncentivesResponse>>
    >();
  });

  it('rejects reserves without a market reference price', () => {
    // @ts-expect-error — formatReserves needs `priceInMarketReferenceCurrency` on every reserve
    formatReserves<{ id: string }>;
  });
});
