/** Pins useBackendIntentByTxHash's params and query result, with the response body spelled out so `data` cannot widen. */
import type { IntentResponse } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { useBackendIntentByTxHash } from './useBackendIntentByTxHash.js';

type Data = IntentResponse;

describe('useBackendIntentByTxHash', () => {
  it('takes a hub tx hash', () => {
    expectTypeOf<Parameters<typeof useBackendIntentByTxHash>>().toEqualTypeOf<
      [{ params?: { txHash: string | undefined }; queryOptions?: ReadQueryOptions<IntentResponse | undefined> }?]
    >();
  });

  it('resolves to the intent, undefined until the tx hash is set', () => {
    expectTypeOf<ReturnType<typeof useBackendIntentByTxHash>>().toEqualTypeOf<
      UseQueryResult<IntentResponse | undefined, Error>
    >();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendIntentByTxHash>['data']>>().toEqualTypeOf<{
      intentHash: string;
      txHash: string;
      logIndex: number;
      chainId: number;
      blockNumber: number;
      open: boolean;
      intent: {
        intentId: string;
        creator: string;
        inputToken: string;
        outputToken: string;
        inputAmount: string;
        minOutputAmount: string;
        deadline: string;
        allowPartialFill: boolean;
        srcChain: number;
        dstChain: number;
        srcAddress: string;
        dstAddress: string;
        solver: string;
        data: string;
      };
      events: unknown[];
    }>();
    // Legitimately unknown: event entries are untyped on the wire; `isFillEvent` narrows them.
    expectTypeOf<Data['events'][number]>().toBeUnknown();
  });
});
