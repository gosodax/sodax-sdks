/** Compile-time contract for `intentDepositSpender`: the approval spender is an EVM address on hub and EVM spokes. */
import { describe, expectTypeOf, it } from 'vitest';
import type { Address, ChainKeys, ConfigService } from '../index.js';
import { intentDepositSpender } from './intentDepositSpender.js';

declare const config: ConfigService;
declare const sonic: typeof ChainKeys.SONIC_MAINNET;
declare const bsc: typeof ChainKeys.BSC_MAINNET;
declare const solana: typeof ChainKeys.SOLANA_MAINNET;

describe('intentDepositSpender', () => {
  it('returns an address for the hub and for an EVM spoke', () => {
    const calls = () => [intentDepositSpender(config, sonic), intentDepositSpender(config, bsc)] as const;
    expectTypeOf<ReturnType<typeof calls>>().toEqualTypeOf<readonly [Address, Address]>();
  });

  it('rejects a non-EVM chain', () => {
    // @ts-expect-error — only the hub and EVM spokes have an EVM spender.
    const call = () => intentDepositSpender(config, solana);
    expectTypeOf(call).toBeFunction();
  });
});
