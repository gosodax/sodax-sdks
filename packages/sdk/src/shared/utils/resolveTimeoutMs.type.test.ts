/** Pins `resolveTimeoutMs` to a number. */
import { describe, expectTypeOf, it } from 'vitest';
import type { resolveTimeoutMs } from './resolveTimeoutMs.js';

describe('shared/utils/resolveTimeoutMs', () => {
  it('resolveTimeoutMs returns number', () => {
    expectTypeOf<ReturnType<typeof resolveTimeoutMs>>().toEqualTypeOf<number>();
  });
});
