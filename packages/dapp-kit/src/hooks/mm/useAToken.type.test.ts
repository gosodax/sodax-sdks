/**
 * Compile-time contract: `useAToken` reads the hub aToken metadata plus the hub chain key, typed exactly, so `data` can never widen to `any`.
 */
import type { Address, ChainKey, Erc20Token } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useAToken } from './useAToken.js';

type Data = Erc20Token & { chainKey: ChainKey };

describe('useAToken', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useAToken>[0]>().toEqualTypeOf<
      { params?: { aToken: Address | string | undefined }; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useAToken>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useAToken>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
