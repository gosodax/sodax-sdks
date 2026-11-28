import { isSodaxError } from '@sodax/sdk';

/**
 * True only for the SDK's `USER_REJECTED` (wallet prompt cancelled); does not re-scan messages, so
 * non-SodaxError rejections intentionally do not match.
 */
export function isUserRejectedError(error: unknown): boolean {
  return isSodaxError(error) && error.code === 'USER_REJECTED';
}
