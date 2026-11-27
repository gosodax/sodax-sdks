import type { EvmSpokeOnlyChainKey, HubChainKey } from '@sodax/types';
import type { ConfigService } from '../shared/config/ConfigService.js';
import { isHubChainKeyType } from '../shared/guards.js';

/** Intent-deposit approval spender: intents contract on the hub, asset manager on an EVM spoke. */
export function intentDepositSpender(config: ConfigService, srcChainKey: HubChainKey | EvmSpokeOnlyChainKey) {
  return isHubChainKeyType(srcChainKey)
    ? config.solver.intentsContract
    : config.getChainConfig(srcChainKey).addresses.assetManager;
}
