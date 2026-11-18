/**
 * Compile-time contract: `useEModes` reads the humanized eMode categories, typed exactly, so `data` can never widen to `any`.
 */
import type { EmodeDataHumanized } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useEModes } from './useEModes.js';

type Data = EmodeDataHumanized[];

describe('useEModes', () => {
  it('takes optional params and query options typed by its data', () => {
    expectTypeOf<Parameters<typeof useEModes>[0]>().toEqualTypeOf<
      { params?: Record<string, never>; queryOptions?: ReadQueryOptions<Data, Error> } | undefined
    >();
  });

  it('returns a query result over the exact data type', () => {
    expectTypeOf<ReturnType<typeof useEModes>>().toEqualTypeOf<UseQueryResult<Data, Error>>();
    expectTypeOf<ReturnType<typeof useEModes>['data']>().toEqualTypeOf<Data | undefined>();
  });
});
