/** Pins the result type of the raw user summary. */
import { describe, expectTypeOf, it } from 'vitest';
import type { RawUserSummaryResponse, generateRawUserSummary } from './generate-raw-user-summary.js';

describe('generateRawUserSummary', () => {
  it('returns the raw summary', () => {
    expectTypeOf<ReturnType<typeof generateRawUserSummary>>().toEqualTypeOf<RawUserSummaryResponse>();
  });
});
