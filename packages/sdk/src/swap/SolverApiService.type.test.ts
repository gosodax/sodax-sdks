/** Compile-time contract for `SolverApiService`: each solver HTTP call's success value and error body. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  Result,
  SolverErrorResponse,
  SolverExecutionResponse,
  SolverIntentQuoteResponse,
  SolverIntentStatusResponse,
} from '../index.js';
import type { SolverApiService } from './SolverApiService.js';

type S = typeof SolverApiService;

describe('SolverApiService', () => {
  it('getQuote', () => {
    expectTypeOf<ReturnType<S['getQuote']>>().toEqualTypeOf<
      Promise<Result<SolverIntentQuoteResponse, SolverErrorResponse>>
    >();
  });

  it('postExecution', () => {
    expectTypeOf<ReturnType<S['postExecution']>>().toEqualTypeOf<
      Promise<Result<SolverExecutionResponse, SolverErrorResponse>>
    >();
  });

  it('getStatus', () => {
    expectTypeOf<ReturnType<S['getStatus']>>().toEqualTypeOf<
      Promise<Result<SolverIntentStatusResponse, SolverErrorResponse>>
    >();
  });
});
