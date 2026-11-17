/** Pins useSwapsApiFilledIntent's params and query result, with the response body spelled out so `data` cannot widen. */
import type { IntentStateV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiFilledIntent } from './useSwapsApiFilledIntent.js';

describe('useSwapsApiFilledIntent', () => {
  it('takes a tx hash', () => {
    expectTypeOf<Parameters<typeof useSwapsApiFilledIntent>>().toEqualTypeOf<
      [
        {
          params?: { txHash: string | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<IntentStateV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the fill state, undefined until the tx hash is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiFilledIntent>>().toEqualTypeOf<
      UseQueryResult<IntentStateV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiFilledIntent>['data']>>().toEqualTypeOf<{
      exists: boolean;
      remainingInput: string;
      receivedOutput: string;
      pendingPayment: boolean;
    }>();
  });
});
