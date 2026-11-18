/**
 * Compile-time contract for `EvmVaultTokenService`: vault reads, signed writes (a `Hex` hash, no raw
 * mode), encoders and decimal translation pin one exact result type each.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { Address, EvmContractCall, Hex, TokenInfo, VaultReserves } from '../../../index.js';
import type { EvmVaultTokenService } from './EvmVaultTokenService.js';

type S = typeof EvmVaultTokenService;

describe('EvmVaultTokenService', () => {
  it('vault reads pin one result type', () => {
    expectTypeOf<ReturnType<S['getTokenInfo']>>().toEqualTypeOf<Promise<TokenInfo>>();
    expectTypeOf<ReturnType<S['getTokenInfos']>>().toEqualTypeOf<Promise<TokenInfo[]>>();
    expectTypeOf<ReturnType<S['getVaultReserves']>>().toEqualTypeOf<Promise<VaultReserves>>();
    expectTypeOf<ReturnType<S['getAllTokenInfo']>>().toEqualTypeOf<
      Promise<{ tokens: readonly Address[]; infos: readonly TokenInfo[]; reserves: readonly bigint[] }>
    >();
  });

  it('writes resolve to the tx hash; encoders and decimal helpers pin one result type', () => {
    expectTypeOf<ReturnType<S['deposit']>>().toEqualTypeOf<Promise<Hex>>();
    expectTypeOf<ReturnType<S['withdraw']>>().toEqualTypeOf<Promise<Hex>>();
    expectTypeOf<ReturnType<S['encodeDeposit']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<S['encodeWithdraw']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<S['translateIncomingDecimals']>>().toEqualTypeOf<bigint>();
    expectTypeOf<ReturnType<S['translateOutgoingDecimals']>>().toEqualTypeOf<bigint>();
  });
});
