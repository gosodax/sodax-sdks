import { assertOk } from '../shared/utils/tiny-invariant.js';
import type { SodaxErrorContext, SodaxFeature } from './codes.js';
import { SodaxError } from './SodaxError.js';

export function sodaxInvariant(
  cond: unknown,
  message: string,
  opts: { feature: SodaxFeature; context?: Partial<SodaxErrorContext> },
): asserts cond {
  assertOk(
    cond,
    () =>
      new SodaxError('VALIDATION_FAILED', message, {
        feature: opts.feature,
        context: { phase: 'validate', ...opts.context },
      }),
  );
}

/** Named type so `asserts cond` survives the factory boundary (TS doesn't propagate it through inferred returns). */
export type FeatureInvariant = (cond: unknown, message: string, context?: Partial<SodaxErrorContext>) => asserts cond;

export function createInvariant(feature: SodaxFeature): FeatureInvariant {
  return (cond, message, context) => {
    sodaxInvariant(cond, message, { feature, context });
  };
}
