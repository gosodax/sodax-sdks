/** Pins the user reserve summary; the reserve type of the input flows through to the result. */
import { describe, expectTypeOf, it } from 'vitest';
import type { FormatReserveUSDResponse } from '../reserve/index.js';
import { type UserReserveSummaryResponse, generateUserReserveSummary } from './generate-user-reserve-summary.js';
import type { CombinedReserveData } from './user-types.js';

type TaggedReserve = FormatReserveUSDResponse & { tag: 'extra' };

declare const plain: CombinedReserveData;
declare const tagged: CombinedReserveData<TaggedReserve>;
const rest = { marketReferencePriceInUsdNormalized: '1', marketReferenceCurrencyDecimals: 8, currentTimestamp: 0 };

// Never invoked: the declared reserves exist only at the type level.
const summarizePlain = () => generateUserReserveSummary({ userReserve: plain, ...rest });
const summarizeTagged = () => generateUserReserveSummary({ userReserve: tagged, ...rest });

describe('generateUserReserveSummary', () => {
  it('keeps the reserve type of the input', () => {
    expectTypeOf<ReturnType<typeof summarizePlain>>().toEqualTypeOf<UserReserveSummaryResponse>();
    expectTypeOf<ReturnType<typeof summarizeTagged>>().toEqualTypeOf<UserReserveSummaryResponse<TaggedReserve>>();
    expectTypeOf<
      ReturnType<typeof summarizePlain>['userReserve']['reserve']
    >().toEqualTypeOf<FormatReserveUSDResponse>();
    expectTypeOf<ReturnType<typeof summarizeTagged>['userReserve']['reserve']>().toEqualTypeOf<TaggedReserve>();
  });
});
