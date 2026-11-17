/** Pins the user reserve formatter; the reserve type of the input flows through to the result. */
import { describe, expectTypeOf, it } from 'vitest';
import type { FormatReserveUSDResponse } from '../reserve/index.js';
import { formatUserReserve } from './format-user-reserve.js';
import type { UserReserveSummaryResponse } from './generate-user-reserve-summary.js';
import type { ComputedUserReserve } from './user-types.js';

type TaggedReserve = FormatReserveUSDResponse & { tag: 'extra' };

declare const plain: UserReserveSummaryResponse;
declare const tagged: UserReserveSummaryResponse<TaggedReserve>;

// Never invoked: the declared reserves exist only at the type level.
const formatPlain = () => formatUserReserve({ reserve: plain, marketReferenceCurrencyDecimals: 8 });
const formatTagged = () => formatUserReserve({ reserve: tagged, marketReferenceCurrencyDecimals: 8 });

describe('formatUserReserve', () => {
  it('keeps the reserve type of the input', () => {
    expectTypeOf<ReturnType<typeof formatPlain>>().toEqualTypeOf<ComputedUserReserve>();
    expectTypeOf<ReturnType<typeof formatTagged>>().toEqualTypeOf<ComputedUserReserve<TaggedReserve>>();
    expectTypeOf<ReturnType<typeof formatPlain>['reserve']>().toEqualTypeOf<FormatReserveUSDResponse>();
    expectTypeOf<ReturnType<typeof formatTagged>['reserve']>().toEqualTypeOf<TaggedReserve>();
  });
});
