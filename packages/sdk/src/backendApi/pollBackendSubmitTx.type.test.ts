/**
 * Compile-time contract for `pollBackendSubmitTx`: `TResult` is inferred from the status fetcher and
 * `TValue` from `onExecuted`, and the result is `{ ok: true; value: TValue } | { ok: false; cause: Error }`.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BridgeApiService,
  BridgeSubmitTxStatusQueryV2,
  BridgeSubmitTxStatusResultV2,
  SubmitTxStatusQueryV2,
  SubmitTxStatusResultV2,
  SwapsApiService,
} from '../index.js';
import { pollBackendSubmitTx } from './pollBackendSubmitTx.js';
import type { SubmitTxAttempt } from './submitTxAttempt.js';

type Polled<V> = Promise<{ ok: true; value: V } | { ok: false; cause: Error }>;

declare const attempt: SubmitTxAttempt;
declare const swaps: SwapsApiService;
declare const bridge: BridgeApiService;
declare const swapsQuery: SubmitTxStatusQueryV2;
declare const bridgeQuery: BridgeSubmitTxStatusQueryV2;

describe('pollBackendSubmitTx', () => {
  it('infers the swaps status result and the success value', () => {
    const call = () =>
      pollBackendSubmitTx({
        attempt,
        terminalStatus: 'solved',
        getStatus: override => swaps.getSubmitTxStatus(swapsQuery, override),
        onExecuted: result => {
          expectTypeOf(result).toEqualTypeOf<SubmitTxStatusResultV2 | undefined>();
          return result?.intent_hash ? { intentHash: result.intent_hash } : undefined;
        },
        requestTimeoutMs: 1_000,
      });
    expectTypeOf<ReturnType<typeof call>>().toEqualTypeOf<Polled<{ intentHash: string }>>();
  });

  it('infers the bridge status result and the success value', () => {
    const call = () =>
      pollBackendSubmitTx({
        attempt,
        terminalStatus: 'executed',
        getStatus: override => bridge.getSubmitTxStatus(bridgeQuery, override),
        onExecuted: (result): string | undefined => {
          expectTypeOf(result).toEqualTypeOf<BridgeSubmitTxStatusResultV2 | undefined>();
          return result?.dstIntentTxHash;
        },
        requestTimeoutMs: 1_000,
      });
    expectTypeOf<ReturnType<typeof call>>().toEqualTypeOf<Polled<string>>();
  });

  it('rejects an onExecuted that does not accept the fetched result', () => {
    const invalid = () =>
      pollBackendSubmitTx({
        attempt,
        terminalStatus: 'executed',
        // @ts-expect-error — the bridge status result has no `intent_hash` for `onExecuted` to read.
        getStatus: override => bridge.getSubmitTxStatus(bridgeQuery, override),
        onExecuted: (result: { intent_hash: string } | undefined) => result?.intent_hash,
        requestTimeoutMs: 1_000,
      });
    expectTypeOf(invalid).toBeFunction();
  });
});
