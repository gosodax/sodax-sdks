/** Compile-time contract: the bnUSD migration encoders return hub calldata as `Hex`. */
import { describe, expectTypeOf, it } from 'vitest';
import type { Hex } from '../index.js';
import type { BnUSDMigrationService } from './BnUSDMigrationService.js';

describe('BnUSDMigrationService result types', () => {
  it('migrateData → Hex', () => {
    expectTypeOf<ReturnType<BnUSDMigrationService['migrateData']>>().toEqualTypeOf<Hex>();
  });

  it('revertMigrationData → Hex', () => {
    expectTypeOf<ReturnType<BnUSDMigrationService['revertMigrationData']>>().toEqualTypeOf<Hex>();
  });
});
