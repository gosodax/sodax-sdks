/**
 * Compile-time contract for `runBackendSubmitTx`: the body, status query and status result types are
 * inferred from the API service passed in, `TValue` from `onExecuted`, and the result is
 * `{ ok: true; value: TValue } | { ok: false; cause: unknown }`.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BridgeApiService,
  BridgeSubmitTxRequestV2,
  BridgeSubmitTxStatusQueryV2,
  BridgeSubmitTxStatusResultV2,
  SubmitTxRequestV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResultV2,
  SwapsApiService,
} from '../index.js';
import { runBackendSubmitTx } from './runBackendSubmitTx.js';
import type { SubmitTxAttempt } from './submitTxAttempt.js';

// `cause` is whatever the API service's loosely typed `Result` failed with, or a local Error.
type Run<V> = Promise<{ ok: true; value: V } | { ok: false; cause: unknown }>;

declare const attempt: SubmitTxAttempt;
declare const swaps: SwapsApiService;
declare const bridge: BridgeApiService;
declare const swapsBody: SubmitTxRequestV2;
declare const swapsQuery: SubmitTxStatusQueryV2;
declare const bridgeBody: BridgeSubmitTxRequestV2;
declare const bridgeQuery: BridgeSubmitTxStatusQueryV2;

describe('runBackendSubmitTx', () => {
  it('infers the swaps request, status result and success value', () => {
    const call = () =>
      runBackendSubmitTx({
        attempt,
        api: swaps,
        body: swapsBody,
        statusQuery: swapsQuery,
        terminalStatus: 'solved',
        onExecuted: result => {
          expectTypeOf(result).toEqualTypeOf<SubmitTxStatusResultV2 | undefined>();
          return result?.intent_hash ? { intentHash: result.intent_hash } : undefined;
        },
        overrideConfig: { apiKey: 'key' },
      });
    expectTypeOf<ReturnType<typeof call>>().toEqualTypeOf<Run<{ intentHash: string }>>();
  });

  it('infers the bridge request, status result and success value', () => {
    const call = () =>
      runBackendSubmitTx({
        attempt,
        api: bridge,
        body: bridgeBody,
        statusQuery: bridgeQuery,
        terminalStatus: 'executed',
        onExecuted: (result): string | undefined => {
          expectTypeOf(result).toEqualTypeOf<BridgeSubmitTxStatusResultV2 | undefined>();
          return result?.dstIntentTxHash;
        },
      });
    expectTypeOf<ReturnType<typeof call>>().toEqualTypeOf<Run<string>>();
  });

  it('rejects a body or query from the other feature, and a timeout override', () => {
    const invalid = () => [
      runBackendSubmitTx({
        attempt,
        api: swaps,
        // @ts-expect-error — the swaps submit-tx body needs the intent and relay data.
        body: bridgeBody,
        statusQuery: swapsQuery,
        terminalStatus: 'solved',
        onExecuted: () => 1,
      }),
      runBackendSubmitTx({
        attempt,
        api: bridge,
        body: bridgeBody,
        statusQuery: bridgeQuery,
        terminalStatus: 'executed',
        onExecuted: () => 1,
        // @ts-expect-error — the attempt budget owns the timeout; only `apiKey` may be overridden.
        overrideConfig: { timeout: 1 },
      }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });
});
