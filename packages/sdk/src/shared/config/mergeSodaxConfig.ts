import type { SodaxConfig, SodaxDefaultConfig, SodaxOptions } from '@sodax/types';
import { deepMerge } from '../utils/deepMerge.js';

/**
 * Deep-merges user overrides over a full base. A `partnerFee` override must be a complete `PartnerFee` (never on the
 * base, so no variant hybrid); the global `fee` and `apiKey` are held on `ConfigService`, not merged here.
 */
export function mergeSodaxConfig(base: SodaxDefaultConfig, override: SodaxOptions): SodaxConfig {
  return deepMerge<SodaxConfig>(base, override);
}
