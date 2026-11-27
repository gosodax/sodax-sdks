import { ChainKeys, type SpokeChainKey } from '@sodax/sdk';
import { loadRadfiSession } from './useRadfiAuth.js';

/**
 * Bitcoin reads resolve the trading address from the LOCAL Bound session (no network), so an API outage never
 * empties a real position; with no session the personal address is returned. Writes resolve it in the SDK.
 */
export function resolveBtcReadAddress(chainKey: SpokeChainKey, address: string): string {
  if (chainKey !== ChainKeys.BITCOIN_MAINNET) return address;
  return loadRadfiSession(address)?.tradingAddress ?? address;
}
