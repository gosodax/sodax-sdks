import { BridgeApiError } from './errors.js';

/**
 * `JSON.stringify` replacer that THROWS on any `bigint`. The bridge wire DTOs are fully
 * string-typed (`inputAmount` etc. travel as decimal strings), so a runtime `bigint` in a request
 * body is a caller bug — surface it loudly instead of crashing `JSON.stringify` or silently
 * dropping the field.
 */
export function rejectBigint(key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    throw new BridgeApiError('VALIDATION_ERROR', `Unexpected bigint at "${key || '<root>'}" in request body`);
  }
  return value;
}
