import type { SodaxConfig, SodaxDefaultConfig, SodaxOptions } from '@sodax/types';
import { deepMerge } from '../utils/deepMerge.js';

/**
 * Layers a user SodaxOptions override on top of a full base config (the static default in the
 * Sodax constructor, or the dynamic config in {@link ConfigService.initialize}).
 *
 * Every field is deep-merged, so a user can override `api.timeout` without dropping the sibling `api.baseURL`,
 * and can set a per-feature `partnerFee` (`swaps` / `moneyMarket` / `bridge` / `leverageYield`) without
 * disturbing that feature's other defaults. A per-feature `partnerFee` is never present on the base config —
 * it is a `SodaxOptions`/feature-options field, not part of `SodaxDefaultConfig` or the backend dynamic
 * config, so it never travels on the wire. Every fee override therefore lands on an empty slot and a complete
 * `PartnerFee` is written wholesale; there is no base variant to merge against, so no partial-variant hybrid
 * (`{address, amount, percentage}`) can arise. `PartnerFee` is a discriminated union and downstream
 * discrimination treats any object with a bigint `amount` as the amount variant (see `isPartnerFeeAmount` /
 * `calculateFeeAmount`), which is exactly why a fee override must be a complete `PartnerFee`, not a partial.
 *
 * The global `fee` is NOT merged here: it is a `SodaxOptions` client option (like `logger`), resolved once
 * and held on `ConfigService.fee`, where it acts as the per-feature fee fallback (`featureFee ?? fee`, via
 * `ConfigService.swapPartnerFee` / `moneyMarketPartnerFee` / `bridgePartnerFee`). Config merging and
 * effective-fee resolution are separate concerns, so the merge layer deliberately leaves `fee` alone.
 * The global `apiKey` is likewise kept off the merged config — `Sodax` strips it at the call site so the
 * credential never lands on the publicly readable `instanceConfig`; it is held on `ConfigService.apiKey`.
 */
export function mergeSodaxConfig(base: SodaxDefaultConfig, override: SodaxOptions): SodaxConfig {
  return deepMerge<SodaxConfig>(base, override);
}
