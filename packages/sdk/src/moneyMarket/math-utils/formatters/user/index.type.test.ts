/** Pins the user summary formatters; the formatted reserve type flows through to the result. */
import { describe, expectTypeOf, it } from 'vitest';
import type { ReservesIncentiveDataHumanized, UserReservesIncentivesDataHumanized } from '../incentive/types.js';
import type { FormatReserveUSDResponse } from '../reserve/index.js';
import {
  type FormatUserSummaryAndIncentivesResponse,
  type FormatUserSummaryResponse,
  type UserReserveDataString,
  formatUserSummary,
  formatUserSummaryAndIncentives,
} from './index.js';

type TaggedReserve = FormatReserveUSDResponse & { tag: 'extra' };

declare const userReserves: UserReserveDataString[];
declare const plain: FormatReserveUSDResponse[];
declare const tagged: TaggedReserve[];
declare const reserveIncentives: ReservesIncentiveDataHumanized[];
declare const userIncentives: UserReservesIncentivesDataHumanized[];
const rest = {
  marketReferencePriceInUsd: '1',
  marketReferenceCurrencyDecimals: 8,
  currentTimestamp: 0,
  userEmodeCategoryId: 0,
};

// Never invoked: the declared inputs exist only at the type level.
const summaryPlain = () => formatUserSummary({ userReserves, formattedReserves: plain, ...rest });
const summaryTagged = () => formatUserSummary({ userReserves, formattedReserves: tagged, ...rest });
const incentivesPlain = () =>
  formatUserSummaryAndIncentives({
    userReserves,
    formattedReserves: plain,
    reserveIncentives,
    userIncentives,
    ...rest,
  });
const incentivesTagged = () =>
  formatUserSummaryAndIncentives({
    userReserves,
    formattedReserves: tagged,
    reserveIncentives,
    userIncentives,
    ...rest,
  });

describe('user summary formatters', () => {
  it('formatUserSummary keeps the formatted reserve type', () => {
    expectTypeOf<ReturnType<typeof summaryPlain>>().toEqualTypeOf<FormatUserSummaryResponse>();
    expectTypeOf<ReturnType<typeof summaryTagged>>().toEqualTypeOf<FormatUserSummaryResponse<TaggedReserve>>();
  });

  it('formatUserSummaryAndIncentives keeps the formatted reserve type and adds the incentives', () => {
    expectTypeOf<ReturnType<typeof incentivesPlain>>().toEqualTypeOf<FormatUserSummaryAndIncentivesResponse>();
    expectTypeOf<ReturnType<typeof incentivesTagged>>().toEqualTypeOf<
      FormatUserSummaryAndIncentivesResponse<TaggedReserve>
    >();
  });
});
