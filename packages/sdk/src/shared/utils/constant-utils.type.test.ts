/** Pins `getEvmViemChain`: any EVM chain key (hub included) to a viem `Chain`; non-EVM keys are rejected. */
import type { Chain } from 'viem';
import { describe, expectTypeOf, it } from 'vitest';
import type { ChainKeys } from '../../index.js';
import { getEvmViemChain } from './constant-utils.js';

declare const BSC: typeof ChainKeys.BSC_MAINNET;
declare const SONIC: typeof ChainKeys.SONIC_MAINNET;
declare const SOLANA: typeof ChainKeys.SOLANA_MAINNET;

describe('shared/utils/constant-utils', () => {
  it('getEvmViemChain returns a viem Chain for EVM spokes and the hub', () => {
    const spoke = () => getEvmViemChain(BSC);
    const hub = () => getEvmViemChain(SONIC);
    expectTypeOf<ReturnType<typeof spoke>>().toEqualTypeOf<Chain>();
    expectTypeOf<ReturnType<typeof hub>>().toEqualTypeOf<Chain>();
    // @ts-expect-error — Solana is not an EVM chain
    const solana = () => getEvmViemChain(SOLANA);
    expectTypeOf(solana).toBeFunction();
  });
});
