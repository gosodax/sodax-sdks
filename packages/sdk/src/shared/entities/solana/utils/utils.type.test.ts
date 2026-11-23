/** Compile-time contract for `solana/utils/utils.ts`: provider/program factories, address codecs and instruction conversion. */
import type { AnchorProvider, Idl, Program } from '@coral-xyz/anchor';
import type { PublicKey } from '@solana/web3.js';
import { describe, expectTypeOf, it } from 'vitest';
import type { Hex, SolanaRawTransactionInstruction } from '../../../../index.js';
import type { AssetManager } from '../types/asset_manager.js';
import type { Connection as ConnectionContract } from '../types/connection.js';
import type {
  convertTransactionInstructionToRaw,
  getAssetManagerIdl,
  getAssetManagerProgram,
  getConnectionIdl,
  getConnectionProgram,
  getProvider,
  getSolanaAddressBytes,
  hexToSolanaAddress,
  isSolanaNativeToken,
} from './utils.js';

describe('solana utils type contract', () => {
  it('provider and programs', () => {
    expectTypeOf<ReturnType<typeof getProvider>>().toEqualTypeOf<Promise<AnchorProvider>>();
    expectTypeOf<ReturnType<typeof getAssetManagerProgram>>().toEqualTypeOf<Promise<Program<AssetManager>>>();
    expectTypeOf<ReturnType<typeof getConnectionProgram>>().toEqualTypeOf<Promise<Program<ConnectionContract>>>();
  });

  it('IDL fetchers resolve to the generic anchor Idl', () => {
    // Fetched on-chain, so the program-specific IDL type is not known statically.
    expectTypeOf<ReturnType<typeof getAssetManagerIdl>>().toEqualTypeOf<Promise<Idl>>();
    expectTypeOf<ReturnType<typeof getConnectionIdl>>().toEqualTypeOf<Promise<Idl>>();
  });

  it('address codecs', () => {
    expectTypeOf<ReturnType<typeof getSolanaAddressBytes>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<typeof hexToSolanaAddress>>().toEqualTypeOf<PublicKey>();
    expectTypeOf<ReturnType<typeof isSolanaNativeToken>>().toEqualTypeOf<boolean>();
  });

  it('instruction conversion', () => {
    expectTypeOf<
      ReturnType<typeof convertTransactionInstructionToRaw>
    >().toEqualTypeOf<SolanaRawTransactionInstruction>();
  });
});
