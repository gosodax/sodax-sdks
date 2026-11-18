/** Pins the EVM helpers: call encoding to `Hex`, receipt wait to `EvmRawTransactionReceipt`. */
import { describe, expectTypeOf, it } from 'vitest';
import type { EvmRawTransactionReceipt, Hex } from '../../index.js';
import type { encodeContractCalls, waitForTransactionReceipt } from './evm-utils.js';

describe('shared/utils/evm-utils', () => {
  it('pins each result', () => {
    expectTypeOf<ReturnType<typeof encodeContractCalls>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<typeof waitForTransactionReceipt>>().toEqualTypeOf<Promise<EvmRawTransactionReceipt>>();
  });
});
