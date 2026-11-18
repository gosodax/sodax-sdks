/**
 * Compile-time contract for the intent-relay API functions: each relay action resolves to its own
 * response type, and the wait helpers to the executed packet.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { PacketData, Result } from '../../../index.js';
import type {
  GetPacketResponse,
  GetRelayResponse,
  GetTransactionPacketsResponse,
  getPacket,
  getTransactionPackets,
  relayTxAndWaitPacket,
  SubmitTxResponse,
  submitTransaction,
  waitUntilIntentExecuted,
} from './IntentRelayApiService.js';

describe('IntentRelayApiService', () => {
  it('each relay action resolves to its own response', () => {
    // Known gap against ADR 0001: the error is a caught value returned as thrown, so it is unknown.
    expectTypeOf<ReturnType<typeof submitTransaction>>().toEqualTypeOf<Promise<Result<SubmitTxResponse>>>();
    expectTypeOf<SubmitTxResponse>().toEqualTypeOf<{ success: boolean; message: string }>();
    expectTypeOf<ReturnType<typeof getTransactionPackets>>().toEqualTypeOf<
      Promise<Result<GetTransactionPacketsResponse>>
    >();
    expectTypeOf<GetTransactionPacketsResponse>().toEqualTypeOf<{ success: boolean; data: PacketData[] }>();
    expectTypeOf<ReturnType<typeof getPacket>>().toEqualTypeOf<Promise<Result<GetPacketResponse>>>();
    expectTypeOf<GetPacketResponse>().toEqualTypeOf<
      { success: true; data: PacketData } | { success: false; message: string }
    >();
  });

  it('GetRelayResponse maps every relay action to its response', () => {
    expectTypeOf<GetRelayResponse<'submit'>>().toEqualTypeOf<SubmitTxResponse>();
    expectTypeOf<GetRelayResponse<'get_transaction_packets'>>().toEqualTypeOf<GetTransactionPacketsResponse>();
    expectTypeOf<GetRelayResponse<'get_packet'>>().toEqualTypeOf<GetPacketResponse>();
  });

  it('the wait helpers resolve to the executed packet', () => {
    expectTypeOf<ReturnType<typeof waitUntilIntentExecuted>>().toEqualTypeOf<Promise<Result<PacketData>>>();
    expectTypeOf<ReturnType<typeof relayTxAndWaitPacket>>().toEqualTypeOf<Promise<Result<PacketData>>>();
  });
});
