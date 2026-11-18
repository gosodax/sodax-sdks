/** Pins `buildEvmRpcTransport` to a viem `Transport`. */
import type { Transport } from 'viem';
import { describe, expectTypeOf, it } from 'vitest';
import type { buildEvmRpcTransport } from './transport-utils.js';

describe('shared/utils/transport-utils', () => {
  it('buildEvmRpcTransport returns Transport', () => {
    expectTypeOf<ReturnType<typeof buildEvmRpcTransport>>().toEqualTypeOf<Transport>();
  });
});
