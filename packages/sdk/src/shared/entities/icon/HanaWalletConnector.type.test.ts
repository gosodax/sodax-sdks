/**
 * Compile-time contract for `HanaWalletConnector.ts`: each Hana/ICONex request resolves to a `Result`
 * of its response payload.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { IconAddress, JsonRpcPayloadResponse, Result } from '../../../index.js';
import { requestAddress, requestJsonRpc, requestSigning } from './HanaWalletConnector.js';

describe('HanaWalletConnector type contract', () => {
  // Error side is `Error | unknown` (= unknown): the extension's rejection reason is passed through.
  it('pins each request result', () => {
    expectTypeOf(requestAddress).returns.toEqualTypeOf<Promise<Result<IconAddress>>>();
    expectTypeOf(requestSigning).returns.toEqualTypeOf<Promise<Result<string>>>();
    expectTypeOf(requestJsonRpc).returns.toEqualTypeOf<Promise<Result<JsonRpcPayloadResponse>>>();
  });

  it('pins the inputs', () => {
    expectTypeOf(requestSigning).parameters.toEqualTypeOf<[from: IconAddress, hash: string]>();
    // `unknown` raw transaction: forwarded verbatim as JSON-RPC params to the wallet extension.
    expectTypeOf(requestJsonRpc).parameter(0).toBeUnknown();
  });
});
