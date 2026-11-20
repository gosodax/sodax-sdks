/** Pins the PDA derivation helpers: each takes the program id (plus seeds) and returns `{ bump, pda }`. */
import type { PublicKey } from '@solana/web3.js';
import type BN from 'bn.js';
import { describe, expectTypeOf, it } from 'vitest';
import { AssetManagerPDA, ConnectionConfigPDA } from './pda.js';

type Pda = { bump: number; pda: PublicKey };

describe('solana pda helpers', () => {
  it('ConnectionConfigPDA derives config and receipt PDAs', () => {
    expectTypeOf(ConnectionConfigPDA.config).toEqualTypeOf<(programId: PublicKey) => Pda>();
    expectTypeOf(ConnectionConfigPDA.receipt).toEqualTypeOf<
      (programId: PublicKey, srcChainId: BN, connectionSn: BN) => Pda
    >();
  });

  it('AssetManagerPDA derives the asset-manager PDAs', () => {
    expectTypeOf(AssetManagerPDA.config).toEqualTypeOf<(programId: PublicKey) => Pda>();
    expectTypeOf(AssetManagerPDA.vault_token).toEqualTypeOf<(programId: PublicKey, mint: PublicKey) => Pda>();
    expectTypeOf(AssetManagerPDA.vault_native).toEqualTypeOf<(programId: PublicKey) => Pda>();
    expectTypeOf(AssetManagerPDA.authority).toEqualTypeOf<(programId: PublicKey) => Pda>();
    expectTypeOf(AssetManagerPDA.ta_creation_fee_account_pda).toEqualTypeOf<
      (programId: PublicKey, mint: PublicKey) => Pda
    >();
  });
});
