/** Pins useBridgeApiAllowance's params and query result, with the response body spelled out so `data` cannot widen. */
import type { BridgeAllowanceCheckResponseV2, CreateBridgeIntentParamsV2, RequestOverrideConfig } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBridgeApiAllowance } from './useBridgeApiAllowance.js';

describe('useBridgeApiAllowance', () => {
  it('takes the create-bridge-intent body', () => {
    expectTypeOf<Parameters<typeof useBridgeApiAllowance>>().toEqualTypeOf<
      [
        {
          params?: { body: CreateBridgeIntentParamsV2 | undefined; apiConfig?: RequestOverrideConfig };
          queryOptions?: ReadQueryOptions<BridgeAllowanceCheckResponseV2 | undefined>;
        }?,
      ]
    >();
  });

  it('resolves to the allowance check, undefined until the body is set', () => {
    expectTypeOf<ReturnType<typeof useBridgeApiAllowance>>().toEqualTypeOf<
      UseQueryResult<BridgeAllowanceCheckResponseV2 | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBridgeApiAllowance>['data']>>().toEqualTypeOf<{ valid: boolean }>();
  });
});
