/**
 * Compile-time contract for `apiConfig.ts`: URL predicates return `boolean`, URL normalizers return
 * `string`, and each per-service resolver returns its exact config type for either `ApiConfig` variant.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ApiConfig,
  BackendApiConfig,
  BaseApiConfig,
  CustomApiConfig,
  RequestOverrideConfig,
  SponsoringApiConfig,
  SwapsApiConfig,
} from '../index.js';
import {
  hasExplicitBasePath,
  hasLegacyBackendBaseURL,
  type isMissingVersionPrefix,
  type normalizeOverrideBaseURL,
  resolveBaseApiConfig,
  resolveBridgeApiConfig,
  resolveLeverageYieldApiConfig,
  resolveSponsoringApiConfig,
  resolveSwapsApiConfig,
  type stripLegacyBackendMount,
} from './apiConfig.js';

declare const flat: BackendApiConfig;
declare const custom: CustomApiConfig;
declare const api: ApiConfig;

describe('URL helpers', () => {
  it('normalize to strings and override configs', () => {
    expectTypeOf<ReturnType<typeof stripLegacyBackendMount>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof normalizeOverrideBaseURL>>().toEqualTypeOf<RequestOverrideConfig | undefined>();
  });

  it('predicates return boolean for either config variant', () => {
    const onFlat = () => hasExplicitBasePath(flat);
    const onCustom = () => hasLegacyBackendBaseURL(custom);
    expectTypeOf<ReturnType<typeof onFlat>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<typeof onCustom>>().toEqualTypeOf<boolean>();
    expectTypeOf<ReturnType<typeof isMissingVersionPrefix>>().toEqualTypeOf<boolean>();
  });
});

describe('resolvers', () => {
  it('return the per-service config, whatever ApiConfig variant they get', () => {
    const base = () => resolveBaseApiConfig(api);
    const swaps = () => resolveSwapsApiConfig(flat);
    const sponsoring = () => resolveSponsoringApiConfig(custom);
    const bridge = () => resolveBridgeApiConfig(api);
    const leverageYield = () => resolveLeverageYieldApiConfig(api);
    // Resolved data-API config always carries a concrete `basePath`.
    expectTypeOf<ReturnType<typeof base>>().toEqualTypeOf<Required<BaseApiConfig & { basePath?: string }>>();
    expectTypeOf<ReturnType<typeof base>['basePath']>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof swaps>>().toEqualTypeOf<SwapsApiConfig>();
    expectTypeOf<ReturnType<typeof sponsoring>>().toEqualTypeOf<SponsoringApiConfig>();
    expectTypeOf<ReturnType<typeof bridge>>().toEqualTypeOf<BaseApiConfig>();
    expectTypeOf<ReturnType<typeof leverageYield>>().toEqualTypeOf<BaseApiConfig>();
    const invalid = () => [
      // @ts-expect-error — `timeout` must be a number of milliseconds.
      resolveSwapsApiConfig({ timeout: '10' }),
    ];
    expectTypeOf(invalid).toBeFunction();
  });
});
