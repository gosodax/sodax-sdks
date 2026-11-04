/**
 * Which of a registry entry's three addresses funds a position deposit.
 *
 * Pure, and separate from the service so it can be checked against the whole token registry without
 * constructing one — see `positionFunding.test.ts`, which asserts the answer for every supported
 * token on every chain. The bug this exists to prevent was two code paths disagreeing, and a
 * disagreement is exactly what an exhaustive check catches.
 */

import { isNativeToken, type SpokeChainKey, type XToken } from '@sodax/types';

/**
 * @param chainKey    The chain the user funds from.
 * @param hubChainKey The hub's own chain key, from `hubProvider.chainConfig.chain.key`.
 * @param token       The registry entry being funded with.
 * @returns The funding address, or `''` when the entry carries none.
 */
export function resolvePositionFundingAddress(
  chainKey: SpokeChainKey,
  hubChainKey: SpokeChainKey,
  token: XToken | undefined,
): string {
  // Off the hub the user holds the spoke original, because that is the chain they are on.
  if (chainKey !== hubChainKey) return token?.address ?? '';
  // A native entry funds AS native; the hub-asset rewrite is for BRIDGED entries, whose `address`
  // belongs to another chain.
  if (token && isNativeToken(chainKey, token)) return token.address;
  return token?.hubAsset ?? token?.address ?? '';
}
