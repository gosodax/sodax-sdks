/**
 * Compile-time contract: `waitForApiAllowance` takes an allowance check, optional request config and
 * timing, and resolves to nothing (it never throws).
 */
import type { RequestOverrideConfig, Result } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import { waitForApiAllowance } from './waitForApiAllowance.js';

declare const check: (config: RequestOverrideConfig) => Promise<Result<{ valid: boolean }>>;
declare const noValid: (config: RequestOverrideConfig) => Promise<Result<{ allowance: bigint }>>;
declare const wideCheck: (config: RequestOverrideConfig) => Promise<Result<{ valid: boolean; spender: string }>>;

describe('waitForApiAllowance', () => {
  it('resolves to void', () => {
    expectTypeOf<ReturnType<typeof waitForApiAllowance>>().toEqualTypeOf<Promise<void>>();
  });

  it('accepts the check, an optional config and optional timing', () => {
    expectTypeOf<Parameters<typeof waitForApiAllowance>>().toEqualTypeOf<
      [
        check: (config: RequestOverrideConfig) => Promise<Result<{ valid: boolean }>>,
        apiConfig?: RequestOverrideConfig,
        timing?: { budgetMs?: number; intervalMs?: number },
      ]
    >();
    const calls = () => [waitForApiAllowance(check), waitForApiAllowance(wideCheck, { timeout: 1 }, { budgetMs: 1 })];
    expectTypeOf(calls).returns.toEqualTypeOf<Promise<void>[]>();
  });

  it('rejects a check that does not report validity', () => {
    const missingValid = () =>
      // @ts-expect-error — the check must resolve to a Result carrying `valid`
      waitForApiAllowance(noValid);
    expectTypeOf(missingValid).toBeFunction();
  });
});
