// Pure so it can be checked against the whole token registry (see positionFunding.test.ts).

import { isNativeToken, type SpokeChainKey, type XToken } from '@sodax/types';

/** Funding address for a position deposit, or `''` when the entry carries none. */
export function resolvePositionFundingAddress(
  chainKey: SpokeChainKey,
  hubChainKey: SpokeChainKey,
  token: XToken | undefined,
): string {
  // Off the hub the user holds the spoke original, because that is the chain they are on.
  if (chainKey !== hubChainKey) return token?.address ?? '';
  // A native entry funds AS native; the hub-asset rewrite is for bridged entries, whose `address` is another chain's.
  if (token && isNativeToken(chainKey, token)) return token.address;
  return token?.hubAsset ?? token?.address ?? '';
}
