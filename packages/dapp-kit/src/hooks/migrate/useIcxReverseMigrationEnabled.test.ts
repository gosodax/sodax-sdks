import { SodaxError, type MigrationLookupError, type Result } from '@sodax/sdk';
import { describe, expect, it, vi } from 'vitest';
import { getIcxReverseMigrationEnabledQueryOptions } from './useIcxReverseMigrationEnabled.js';

const makeSodax = (result: Result<boolean, MigrationLookupError>) => {
  const isReverseMigrationEnabled = vi.fn(async () => result);
  return { sodax: { migration: { icxMigration: { isReverseMigrationEnabled } } }, isReverseMigrationEnabled };
};

describe('getIcxReverseMigrationEnabledQueryOptions', () => {
  it('uses a fixed key — the switch is global, not per user', () => {
    const { sodax } = makeSodax({ ok: true, value: true });
    expect(getIcxReverseMigrationEnabledQueryOptions({ sodax }).queryKey).toEqual([
      'migrate',
      'icxReverseMigrationEnabled',
    ]);
  });

  it('returns the contract switch value', async () => {
    const { sodax, isReverseMigrationEnabled } = makeSodax({ ok: true, value: false });
    await expect(getIcxReverseMigrationEnabledQueryOptions({ sodax }).queryFn()).resolves.toBe(false);
    expect(isReverseMigrationEnabled).toHaveBeenCalledOnce();
  });

  it('THROWS on lookup failure so React Query reports isError instead of a false "disabled"', async () => {
    const lookupError = new SodaxError('LOOKUP_FAILED', 'reverseSwapEnabled read failed', { feature: 'migration' });
    const { sodax } = makeSodax({ ok: false, error: lookupError });
    await expect(getIcxReverseMigrationEnabledQueryOptions({ sodax }).queryFn()).rejects.toBe(lookupError);
  });
});
