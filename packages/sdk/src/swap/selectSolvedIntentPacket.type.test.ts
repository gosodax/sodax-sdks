/** Compile-time contract for the solved-packet selector: both results are optional when nothing matches. */
import { describe, expectTypeOf, it } from 'vitest';
import type { PacketData } from '../index.js';
import { decodePacketIntentTarget, selectSolvedIntentPacket } from './selectSolvedIntentPacket.js';

describe('selectSolvedIntentPacket', () => {
  it('decodePacketIntentTarget returns the lowercase target or undefined', () => {
    expectTypeOf(decodePacketIntentTarget).returns.toEqualTypeOf<string | undefined>();
  });

  it('selectSolvedIntentPacket returns one of the packets or undefined', () => {
    expectTypeOf(selectSolvedIntentPacket).returns.toEqualTypeOf<PacketData | undefined>();
  });
});
