/** Pins useSwapsApiStatus's params and query result, with the response body spelled out so `data` cannot widen. */
import type { RequestOverrideConfig, StatusResponseV2, SwapIntentStatusCodeV2 } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiStatus } from './useSwapsApiStatus.js';

describe('useSwapsApiStatus', () => {
  it('takes an intent tx hash', () => {
    expectTypeOf<Parameters<typeof useSwapsApiStatus>>().toEqualTypeOf<
      [
        {
          params?: { intentTxHash: string | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<StatusResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the intent status, undefined until the tx hash is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiStatus>>().toEqualTypeOf<
      UseQueryResult<StatusResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiStatus>['data']>>().toEqualTypeOf<{
      status: SwapIntentStatusCodeV2;
      fillTxHash?: string;
    }>();
  });
});
