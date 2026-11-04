import type { Address, SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';

/** Params for {@link useLeveragePositionPayoutAddress}. */
export type UseLeveragePositionPayoutAddressParams = {
  /** The chain the user signs on. */
  chainKey: SpokeChainKey;
  /**
   * Their address on that chain. Supplied by the caller — this package does not depend on a wallet
   * layer, so it cannot read the connected account itself.
   */
  signerAddress: Address | undefined;
  /** The position's owner, from `useGetUserHubWalletAddress`. */
  owner: Address | undefined;
};

/**
 * Where funds leaving a position can actually be paid.
 *
 * `withdraw` is a plain pool withdrawal, so it pays out to an address ON THE HUB. For a hub-chain
 * user that can be their own address; for anyone else it cannot — their signing address belongs to
 * another chain, and for a non-EVM chain it is not an address the hub could pay at all. The hub
 * wallet is the one destination that is always theirs, and bridging onward is a separate operation.
 *
 * Returns `undefined` while either address is still resolving, which is the disabled state for a
 * withdraw button rather than a reason to fall back to the signer.
 */
export function useLeveragePositionPayoutAddress({
  params,
}: {
  params?: UseLeveragePositionPayoutAddressParams;
} = {}): Address | undefined {
  const { sodax } = useSodaxContext();
  if (!params) return undefined;
  return params.chainKey === sodax.hubProvider.chainConfig.chain.key ? params.signerAddress : params.owner;
}
