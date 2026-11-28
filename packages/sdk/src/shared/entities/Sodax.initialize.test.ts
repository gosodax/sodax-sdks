/**
 * End-to-end guard for the Sodax → ConfigService wiring and the current no-op initialize() contract.
 *
 * NOTE: `ConfigService.initialize()` is currently a deliberate no-op (pending the v2 config endpoint).
 * TODO(config-v2): when its dynamic fetch is re-enabled, add the regression this file exists for —
 * ConfigService.initialize() once did `this.sodax = response.config`, so a successful `initialize()`
 * silently discarded every override passed to `new Sodax(...)`. Drive the real
 * `new Sodax(override)` → `sodax.initialize()` path with only `backendApi.getAllConfig` stubbed, and assert
 * a user override (top-level and nested) survives while non-overridden fields adopt the remote config.
 * The previously parked (commented-out) suites for this are at `git show 6d7ee73:packages/sdk/src/shared/entities/Sodax.initialize.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PartnerFee } from '@sodax/types';
import { Sodax } from './Sodax.js';

const USER_FEE: PartnerFee = { address: '0x1111111111111111111111111111111111111111', percentage: 123 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Sodax.initialize — current no-op contract (dynamic fetch/merge disabled)', () => {
  it('resolves ok, preserves the constructor-merged override, and does not fetch while initialize() is a no-op', async () => {
    const sodax = new Sodax({ fee: USER_FEE });
    const getAllConfig = vi.spyOn(sodax.backendApi, 'getAllConfig');

    const result = await sodax.initialize();

    expect(result.ok).toBe(true);
    expect(sodax.config.fee).toEqual(USER_FEE); // Sodax → ConfigService wiring carries the held fee option
    expect(sodax.config.isInitialized()).toBe(false); // no-op never flips the flag
    expect(getAllConfig).not.toHaveBeenCalled(); // initialize() does not fetch while disabled
  });
});
