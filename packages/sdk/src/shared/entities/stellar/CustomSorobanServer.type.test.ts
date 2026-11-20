/** Compile-time contract for `CustomSorobanServer.ts`: each override keeps the Soroban RPC response type. */
import type { rpc } from '@stellar/stellar-sdk';
import { describe, expectTypeOf, it } from 'vitest';
import type { CustomSorobanServer } from './CustomSorobanServer.js';

type R<M extends keyof CustomSorobanServer> = CustomSorobanServer[M] extends (...args: never[]) => infer T ? T : never;

describe('CustomSorobanServer type contract', () => {
  it('pins each RPC result', () => {
    expectTypeOf<R<'getNetwork'>>().toEqualTypeOf<Promise<rpc.Api.GetNetworkResponse>>();
    expectTypeOf<R<'simulateTransaction'>>().toEqualTypeOf<Promise<rpc.Api.SimulateTransactionResponse>>();
    expectTypeOf<R<'sendTransaction'>>().toEqualTypeOf<Promise<rpc.Api.SendTransactionResponse>>();
    expectTypeOf<R<'getTransaction'>>().toEqualTypeOf<Promise<rpc.Api.GetTransactionResponse>>();
  });
});
