import { isAuthFailure } from '@sodax/sdk';

const MAX_RETRIES = 3;

/** Default `retry` for backend API hooks: retries transport failures, never a rejected API key. */
export const retryUnlessAuthFailure = (failureCount: number, error: unknown): boolean =>
  !isAuthFailure(error) && failureCount < MAX_RETRIES;
