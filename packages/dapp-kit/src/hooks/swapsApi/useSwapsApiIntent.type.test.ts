/** Pins useSwapsApiIntent's params and query result, with the response body spelled out so `data` cannot widen. */
import type { GetIntentResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiIntent } from './useSwapsApiIntent.js';

describe('useSwapsApiIntent', () => {
  it('takes a tx hash', () => {
    expectTypeOf<Parameters<typeof useSwapsApiIntent>>().toEqualTypeOf<
      [
        {
          params?: { txHash: string | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<GetIntentResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the intent, undefined until the tx hash is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiIntent>>().toEqualTypeOf<
      UseQueryResult<GetIntentResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiIntent>['data']>>().toEqualTypeOf<{
      intentId: string;
      creator: string;
      inputToken: string;
      outputToken: string;
      inputAmount: string;
      minOutputAmount: string;
      deadline: string;
      allowPartialFill: boolean;
      srcChain: string;
      dstChain: string;
      srcAddress: string;
      dstAddress: string;
      solver: string;
      data: string;
    }>();
  });
});
