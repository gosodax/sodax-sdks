/** Compile-time contract: each migration guard narrows `unknown` to exactly its params type. */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  BalnMigrateParams,
  IcxCreateRevertMigrationParams,
  IcxMigrateParams,
  SpokeChainKey,
  UnifiedBnUSDMigrateParams,
} from '../index.js';
import type {
  isBalnMigrateParams,
  isIcxCreateRevertMigrationParams,
  isIcxMigrateParams,
  isUnifiedBnUSDMigrateParams,
} from './migration-guards.js';

describe('migration guard narrowing', () => {
  it('isIcxMigrateParams guards IcxMigrateParams', () => {
    expectTypeOf<typeof isIcxMigrateParams>().guards.toEqualTypeOf<IcxMigrateParams>();
  });

  it('isUnifiedBnUSDMigrateParams guards UnifiedBnUSDMigrateParams over any spoke chain', () => {
    expectTypeOf<typeof isUnifiedBnUSDMigrateParams>().guards.toEqualTypeOf<UnifiedBnUSDMigrateParams<SpokeChainKey>>();
  });

  it('isBalnMigrateParams guards BalnMigrateParams', () => {
    expectTypeOf<typeof isBalnMigrateParams>().guards.toEqualTypeOf<BalnMigrateParams>();
  });

  it('isIcxCreateRevertMigrationParams guards IcxCreateRevertMigrationParams', () => {
    expectTypeOf<typeof isIcxCreateRevertMigrationParams>().guards.toEqualTypeOf<IcxCreateRevertMigrationParams>();
  });
});
