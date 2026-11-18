/**
 * Compile-time contract: the solver polling policy returns an interval or `false`, a plain miss
 * flag, and a solver status read narrowed from a detailed read.
 */
import type { Result, SodaxError, SolverErrorResponse, SolverIntentStatusResponse } from '@sodax/sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  getSolverDetailedStatusRefetchInterval,
  getSolverStatusRefetchInterval,
  isSolverNotFound,
  SolverDetailedStatusRead,
  SolverStatusRead,
  toNotFoundBudgetRead,
} from './solverStatusPolicy.js';

type StatusRead = Result<SolverIntentStatusResponse, SolverErrorResponse> | undefined;
type DetailedRead =
  | Result<
      { source: 'backend'; data: { status: string } } | { source: 'solver'; data: SolverIntentStatusResponse },
      SodaxError<'LOOKUP_FAILED'>
    >
  | undefined;

describe('read shapes', () => {
  it('pins the structural reads the policy consumes', () => {
    expectTypeOf<SolverStatusRead>().toEqualTypeOf<StatusRead>();
    expectTypeOf<SolverDetailedStatusRead>().toEqualTypeOf<DetailedRead>();
  });
});

describe('getSolverStatusRefetchInterval', () => {
  it('returns a poll interval or false', () => {
    expectTypeOf<Parameters<typeof getSolverStatusRefetchInterval>>().toEqualTypeOf<
      [data: StatusRead, consecutiveNotFound: number]
    >();
    expectTypeOf<ReturnType<typeof getSolverStatusRefetchInterval>>().toEqualTypeOf<number | false>();
  });
});

describe('isSolverNotFound', () => {
  it('returns a plain boolean', () => {
    expectTypeOf<Parameters<typeof isSolverNotFound>>().toEqualTypeOf<[data: StatusRead]>();
    expectTypeOf<ReturnType<typeof isSolverNotFound>>().toEqualTypeOf<boolean>();
  });
});

describe('toNotFoundBudgetRead', () => {
  it('maps a detailed read onto a solver status read', () => {
    expectTypeOf<Parameters<typeof toNotFoundBudgetRead>>().toEqualTypeOf<[data: DetailedRead]>();
    expectTypeOf<ReturnType<typeof toNotFoundBudgetRead>>().toEqualTypeOf<StatusRead>();
  });
});

describe('getSolverDetailedStatusRefetchInterval', () => {
  it('returns a poll interval or false', () => {
    expectTypeOf<Parameters<typeof getSolverDetailedStatusRefetchInterval>>().toEqualTypeOf<
      [data: DetailedRead, consecutiveNotFound: number]
    >();
    expectTypeOf<ReturnType<typeof getSolverDetailedStatusRefetchInterval>>().toEqualTypeOf<number | false>();
  });
});
