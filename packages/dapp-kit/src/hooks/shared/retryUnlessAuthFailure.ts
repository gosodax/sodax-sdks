import { isAuthFailure } from '@sodax/sdk';

/** Retries a repeatable failure gets, matching the `retry: 3` these hooks used before. */
const MAX_RETRIES = 3;

/**
 * Default React Query `retry` policy for the backend API hooks (swaps, leverage-yield, bridge): replay a transport blip, never a
 * terminal API-key rejection (see `isAuthFailure`). Retrying a rejected key only multiplies doomed
 * requests before the consumer sees the error.
 *
 * Override or compose it through `queryOptions` / `mutationOptions`:
 *
 * ```ts
 * useSwapsApiQuote({ params: { body }, queryOptions: { retry: 5 } });
 * ```
 */
export const retryUnlessAuthFailure = (failureCount: number, error: unknown): boolean =>
  !isAuthFailure(error) && failureCount < MAX_RETRIES;
