/** Compile-time contract: the ICX migration lookups and encoders return their exact hub-side types. */
import { describe, expectTypeOf, it } from 'vitest';
import type { EvmContractCall, Hex, MigrationLookupError, Result } from '../index.js';
import type { IcxMigrationService } from './IcxMigrationService.js';

describe('IcxMigrationService result types', () => {
  it('getAvailableAmount → Promise<Result<bigint, MigrationLookupError>>', () => {
    expectTypeOf<ReturnType<IcxMigrationService['getAvailableAmount']>>().toEqualTypeOf<
      Promise<Result<bigint, MigrationLookupError>>
    >();
  });

  it('migrateData and revertMigration → Hex', () => {
    expectTypeOf<ReturnType<IcxMigrationService['migrateData']>>().toEqualTypeOf<Hex>();
    expectTypeOf<ReturnType<IcxMigrationService['revertMigration']>>().toEqualTypeOf<Hex>();
  });

  it('encodeMigrate and encodeRevertMigration → EvmContractCall', () => {
    expectTypeOf<ReturnType<IcxMigrationService['encodeMigrate']>>().toEqualTypeOf<EvmContractCall>();
    expectTypeOf<ReturnType<IcxMigrationService['encodeRevertMigration']>>().toEqualTypeOf<EvmContractCall>();
  });
});
