/** Pins the result type of the native-to-USD conversion. */
import { describe, expectTypeOf, it } from 'vitest';
import type { nativeToUSD } from './native-to-usd.js';

describe('nativeToUSD', () => {
  it('returns a decimal string', () => {
    expectTypeOf<ReturnType<typeof nativeToUSD>>().toEqualTypeOf<string>();
  });
});
