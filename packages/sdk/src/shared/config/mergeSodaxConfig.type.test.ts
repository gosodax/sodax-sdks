/** Compile-time contract for `mergeSodaxConfig.ts`: a default config plus options yields a `SodaxConfig`. */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxConfig, SodaxDefaultConfig, SodaxOptions } from '../../index.js';
import { mergeSodaxConfig } from './mergeSodaxConfig.js';

declare const base: SodaxDefaultConfig;
declare const options: SodaxOptions;
const merged = () => mergeSodaxConfig(base, options);
const invalid = () =>
  // @ts-expect-error — the base must be a full default config, not partial options
  mergeSodaxConfig(options, options);

describe('mergeSodaxConfig type contract', () => {
  it('returns SodaxConfig', () => {
    expectTypeOf(merged).returns.toEqualTypeOf<SodaxConfig>();
    expectTypeOf(invalid).returns.toEqualTypeOf<SodaxConfig>();
  });
});
