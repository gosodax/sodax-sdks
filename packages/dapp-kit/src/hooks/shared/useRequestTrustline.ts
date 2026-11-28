import { useCallback, useRef } from 'react';
import { useEstablishTrustline, type UseEstablishTrustlineVars } from './useEstablishTrustline.js';

// The 2.0.0 shape, declared explicitly so a change fails `checkTs` here instead of breaking consumers.
type ReleasedRequestTrustline = {
  requestTrustline: (params: UseEstablishTrustlineVars) => Promise<string>;
  isLoading: boolean;
  isRequested: boolean;
  error: Error | null;
  data: string | null;
};

/**
 * @deprecated Use {@link useEstablishTrustline}; removed in the next major. `token` is ignored, as in 2.0.0.
 */
export function useRequestTrustline(token?: string | undefined): ReleasedRequestTrustline {
  const { mutateAsync, isPending, isSuccess, error, data } = useEstablishTrustline();

  // Latch like 2.0.0 did: React Query resets these on the next attempt, but a failed retry
  // must not un-report a trustline that succeeded.
  const requested = useRef(false);
  const lastData = useRef<string | null>(null);
  if (isSuccess) requested.current = true;
  if (data !== undefined) lastData.current = data;

  const requestTrustline = useCallback(
    async (params: UseEstablishTrustlineVars): Promise<string> => {
      try {
        return await mutateAsync(params);
      } catch (err) {
        // 2.0.0 guaranteed this callback rejects with an `Error`.
        throw err instanceof Error ? err : new Error('Unknown error occurred');
      }
    },
    [mutateAsync],
  );

  return {
    requestTrustline,
    isLoading: isPending,
    isRequested: requested.current,
    error,
    data: lastData.current,
  };
}
