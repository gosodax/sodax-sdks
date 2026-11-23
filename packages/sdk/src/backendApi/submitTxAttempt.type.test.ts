/**
 * Compile-time contract for `submitTxAttempt.ts`: the budget factory returns a `SubmitTxAttempt` whose
 * per-request bound is `number | null`, and the budget explainer returns a plain `Error`.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { createSubmitTxAttempt, noRequestBudgetCause, SubmitTxAttempt } from './submitTxAttempt.js';

describe('submitTxAttempt', () => {
  it('createSubmitTxAttempt returns the attempt budget', () => {
    expectTypeOf<ReturnType<typeof createSubmitTxAttempt>>().toEqualTypeOf<SubmitTxAttempt>();
    expectTypeOf<ReturnType<SubmitTxAttempt['remaining']>>().toEqualTypeOf<number>();
    // `null` means "issue no request"; callers must check before using it as a timeout.
    expectTypeOf<ReturnType<SubmitTxAttempt['requestTimeout']>>().toEqualTypeOf<number | null>();
  });

  it('noRequestBudgetCause returns an Error', () => {
    expectTypeOf<ReturnType<typeof noRequestBudgetCause>>().toEqualTypeOf<Error>();
  });
});
