/**
 * Compile-time contract for `analytics.ts`: `resolveAnalytics` yields a `ResolvedAnalytics` for every
 * option, and `trackResult` returns the wrapped flow's `Result` unchanged.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { AnalyticsConfig, AnalyticsOption, Result, SodaxError } from '../index.js';
import { noopAnalytics, type ResolvedAnalytics, resolveAnalytics } from './analytics.js';

declare const config: AnalyticsConfig;
declare const flow: () => Promise<Result<{ txHash: `0x${string}` }, SodaxError>>;
const resolved = () => [resolveAnalytics(undefined), resolveAnalytics(false), resolveAnalytics(config)] as const;
const tracked = () => noopAnalytics.trackResult('swap', 'swap', flow);
const invalid = () =>
  // @ts-expect-error — `true` is not an AnalyticsOption; pass a config object to enable
  resolveAnalytics(true);

describe('analytics type contract', () => {
  it('resolveAnalytics returns a ResolvedAnalytics for every option', () => {
    expectTypeOf(resolveAnalytics).parameter(0).toEqualTypeOf<AnalyticsOption | undefined>();
    expectTypeOf<ReturnType<typeof resolved>>().toEqualTypeOf<
      readonly [ResolvedAnalytics, ResolvedAnalytics, ResolvedAnalytics]
    >();
    expectTypeOf(invalid).returns.toEqualTypeOf<ResolvedAnalytics>();
  });

  it('the emitter methods keep their result types', () => {
    expectTypeOf(noopAnalytics).toEqualTypeOf<ResolvedAnalytics>();
    expectTypeOf<ReturnType<ResolvedAnalytics['isEnabled']>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<ResolvedAnalytics['emit']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<typeof tracked>>().toEqualTypeOf<Promise<Result<{ txHash: `0x${string}` }, SodaxError>>>();
  });
});
