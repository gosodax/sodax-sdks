/** Pins useBackendOrderbook's params and query result, with the response body spelled out so `data` cannot widen. */
import type { OrderbookResponse } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expectTypeOf, it } from 'vitest';
import type { ReadQueryOptions } from '../shared/types.js';
import type { BackendPaginationParams } from './types.js';
import type { useBackendOrderbook } from './useBackendOrderbook.js';

describe('useBackendOrderbook', () => {
  it('takes pagination', () => {
    expectTypeOf<Parameters<typeof useBackendOrderbook>>().toEqualTypeOf<
      [{ params?: { pagination: BackendPaginationParams }; queryOptions?: ReadQueryOptions<OrderbookResponse> }?]
    >();
  });

  it('resolves to the orderbook page', () => {
    expectTypeOf<ReturnType<typeof useBackendOrderbook>>().toEqualTypeOf<UseQueryResult<OrderbookResponse, Error>>();
    expectTypeOf<NonNullable<ReturnType<typeof useBackendOrderbook>['data']>>().toEqualTypeOf<{
      total: number;
      data: {
        intentState: { exists: boolean; remainingInput: string; receivedOutput: string; pendingPayment: boolean };
        intentData: {
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
          intentHash: string;
          txHash: string;
          blockNumber: number;
        };
      }[];
    }>();
  });
});
