/**
 * Compile-time contract: `useNearStorageCheck` reads a boolean registration flag.
 */
import type { SpokeChainKey } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadHookParams } from './types.js';
import type { UseNearStorageCheckParams, useNearStorageCheck } from './useNearStorageCheck.js';

type Params = ReadHookParams<
  boolean,
  { token: string | undefined; accountId: string | undefined; chainId: SpokeChainKey | undefined }
>;

describe('useNearStorageCheck', () => {
  it('accepts optional read-hook params', () => {
    expectTypeOf<UseNearStorageCheckParams>().toEqualTypeOf<Params>();
    expectTypeOf<Parameters<typeof useNearStorageCheck>>().toEqualTypeOf<[params?: Params]>();
  });

  it('returns a boolean query', () => {
    expectTypeOf<ReturnType<typeof useNearStorageCheck>>().toEqualTypeOf<UseQueryResult<boolean, Error>>();
    expectTypeOf<ReturnType<typeof useNearStorageCheck>['data']>().toEqualTypeOf<boolean | undefined>();
  });
});
