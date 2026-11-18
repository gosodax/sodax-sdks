/** Compile-time contract for `IntentDataService`: the `Intent.data` envelope codec's exact result types. */
import { describe, expectTypeOf, it } from 'vitest';
import type { Hex } from '../index.js';
import type { IntentDataService } from './IntentDataService.js';

type S = typeof IntentDataService;

describe('IntentDataService', () => {
  it('encoders return the envelope bytes', () => {
    expectTypeOf<ReturnType<S['composeIntentData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<S['encodeIntentData']>>().toEqualTypeOf<Hex>();
  });

  it('extractFeePayload is undefined when the data carries no fee', () => {
    expectTypeOf<ReturnType<S['extractFeePayload']>>().toEqualTypeOf<Hex | undefined>();
  });
});
