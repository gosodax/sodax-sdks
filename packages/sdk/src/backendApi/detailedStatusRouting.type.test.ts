/**
 * Compile-time contract for `detailedStatusRouting.ts`: the abandonment check is a plain boolean, the
 * journal reader yields its two-kind outcome or `undefined`, and the relay read yields a delivered packet
 * or an untagged, budget-flagged failure.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BridgeSubmitTxStatusResponseV2,
  ChainKeys,
  HttpUrl,
  PacketData,
  SubmitTxStatusResponseV2,
} from '../index.js';
import {
  isBackendSubmitTxAbandoned,
  type readIntentJournalOutcome,
  resolveDeliveredPacket,
} from './detailedStatusRouting.js';

declare const swapsStatus: SubmitTxStatusResponseV2;
declare const bridgeStatus: BridgeSubmitTxStatusResponseV2;
declare const relayer: HttpUrl;
declare const bsc: typeof ChainKeys.BSC_MAINNET;

describe('isBackendSubmitTxAbandoned', () => {
  it('accepts every feature status record and returns boolean', () => {
    const swaps = () => isBackendSubmitTxAbandoned(swapsStatus.data);
    const bridge = () => isBackendSubmitTxAbandoned(bridgeStatus.data);
    expectTypeOf<ReturnType<typeof swaps>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<typeof bridge>>().toEqualTypeOf<boolean>();
    const invalid = () => [
      // @ts-expect-error — a record needs a `status`.
      isBackendSubmitTxAbandoned({ abandonedAt: 'x' }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });
});

describe('readIntentJournalOutcome', () => {
  it('returns the solved or cancelled outcome, or undefined', () => {
    expectTypeOf<ReturnType<typeof readIntentJournalOutcome>>().toEqualTypeOf<
      { kind: 'solved'; fillTxHash: string } | { kind: 'cancelled' } | undefined
    >();
  });
});

describe('resolveDeliveredPacket', () => {
  it('returns the delivered packet or a budget-flagged failure', () => {
    const call = () =>
      resolveDeliveredPacket({
        srcChainKey: bsc,
        srcTxHash: '0x1',
        relayerApiEndpoint: relayer,
        backendAnswered: true,
      });
    // `cause` carries whatever the relay read failed with (HTTP, transport, parse), deliberately untagged.
    expectTypeOf<ReturnType<typeof call>>().toEqualTypeOf<
      Promise<{ ok: true; packet: PacketData } | { ok: false; cause: unknown; budgetable: boolean }>
    >();
    const invalid = () => [
      resolveDeliveredPacket({
        // @ts-expect-error — the source chain must be a spoke chain key.
        srcChainKey: 'nope',
        srcTxHash: '0x1',
        relayerApiEndpoint: relayer,
        backendAnswered: true,
      }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });
});
