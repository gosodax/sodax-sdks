/** Pins `mapRelayFailure` to the three relay codes it can produce. */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxError } from '../index.js';
import { mapRelayFailure } from './relay-error-mapping.js';

describe('errors/relay-error-mapping', () => {
  it('mapRelayFailure returns a SodaxError over the relay codes only', () => {
    expectTypeOf<ReturnType<typeof mapRelayFailure>>().toEqualTypeOf<
      SodaxError<'RELAY_TIMEOUT' | 'TX_SUBMIT_FAILED' | 'RELAY_FAILED'>
    >();
    // @ts-expect-error — phase is limited to 'relay' | 'destinationExecution'
    const invalid = () => mapRelayFailure(new Error('x'), { feature: 'swap', phase: 'approve' });
    expectTypeOf(invalid).toBeFunction();
  });
});
