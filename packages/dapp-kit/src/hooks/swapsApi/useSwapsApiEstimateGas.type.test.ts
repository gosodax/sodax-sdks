/** Pins useSwapsApiEstimateGas's params and query result, with the response body spelled out so `data` cannot widen. */
import type { GasEstimateRequestV2, GasEstimateResponseV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useSwapsApiEstimateGas } from './useSwapsApiEstimateGas.js';

type Data = GasEstimateResponseV2;

describe('useSwapsApiEstimateGas', () => {
  it('takes the gas-estimate body', () => {
    expectTypeOf<Parameters<typeof useSwapsApiEstimateGas>>().toEqualTypeOf<
      [
        {
          params?: { body: GasEstimateRequestV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<GasEstimateResponseV2 | undefined>;
        }?,
      ]
    >();
    // The request `tx` is an untyped record on the wire, not the chain's raw transaction type.
    expectTypeOf<GasEstimateRequestV2>().toEqualTypeOf<{ chainKey: string; tx: Record<string, unknown> }>();
  });

  it('resolves to the gas estimate, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useSwapsApiEstimateGas>>().toEqualTypeOf<
      UseQueryResult<GasEstimateResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useSwapsApiEstimateGas>['data']>>().toEqualTypeOf<{ gas: unknown }>();
    // Legitimately unknown: the estimate shape varies by chain family and `chainKey` is a plain string.
    expectTypeOf<Data['gas']>().toBeUnknown();
  });
});
