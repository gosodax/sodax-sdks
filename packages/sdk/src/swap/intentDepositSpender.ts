import type { EvmSpokeOnlyChainKey, HubChainKey } from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';
import { isHubChainKeyType } from '../shared/guards.js';

/**
 * The contract an intent deposit (a swap, or a leverage-yield vault swap) must be approved to: the
 * intents contract on the hub, the chain's asset manager on an EVM spoke.
 */
export function intentDepositSpender(config: ConfigService, srcChainKey: HubChainKey | EvmSpokeOnlyChainKey) {
  return isHubChainKeyType(srcChainKey)
    ? config.solver.intentsContract
    : config.getChainConfig(srcChainKey).addresses.assetManager;
}
