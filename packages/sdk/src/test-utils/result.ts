// Test-only helpers for asserting on the SDK's `Result<T, E>` without a guard-and-return after every expect.
import type { Result } from '@sodax/types';
import { expect } from 'vitest';
import type { SodaxErrorCode } from '../errors/codes.js';
import { SodaxError } from '../errors/SodaxError.js';

/** Asserts `result` succeeded and returns its value; a failure prints the error it carried. */
export function expectOk<T, E>(result: Result<T, E>, label?: string): T {
  if (!result.ok) expect.fail(`${label ? `${label}: ` : ''}expected ok, got error ${summarize(result.error)}`);
  return result.value;
}

/**
 * Asserts `result` failed with a `SodaxError`, optionally of `code` and with `context` as a subset,
 * and returns the error for any further assertions.
 */
export function expectErr<T, E>(
  result: Result<T, E>,
  code?: SodaxErrorCode,
  context?: Record<string, unknown>,
  label?: string,
): SodaxError {
  const prefix = label ? `${label}: ` : '';
  if (result.ok) expect.fail(`${prefix}expected an error${code ? ` (${code})` : ''}, got ok`);
  const error = result.error;
  if (!(error instanceof SodaxError)) expect.fail(`${prefix}expected a SodaxError, got ${summarize(error)}`);
  if (code !== undefined) expect(error.code, `${prefix}error code`).toBe(code);
  if (context !== undefined) expect(error.context, `${prefix}error context`).toMatchObject(context);
  return error;
}

function summarize(value: unknown): string {
  if (value instanceof SodaxError) return `${value.code}: ${value.message}`;
  if (value instanceof Error) return value.message;
  return String(value);
}
