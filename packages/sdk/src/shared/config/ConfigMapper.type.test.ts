/** Compile-time contract for `ConfigMapper.ts`: parsing yields a readonly `XToken` array. */
import { describe, expectTypeOf, it } from 'vitest';
import type { XToken } from '../../index.js';
import { parseTokenArrayFromJson } from './ConfigMapper.js';

describe('ConfigMapper type contract', () => {
  it('parseTokenArrayFromJson returns readonly XToken[]', () => {
    // `unknown` input is deliberate: it validates an untrusted JSON value.
    expectTypeOf(parseTokenArrayFromJson).parameter(0).toBeUnknown();
    expectTypeOf(parseTokenArrayFromJson).returns.toEqualTypeOf<readonly XToken[]>();
  });
});
