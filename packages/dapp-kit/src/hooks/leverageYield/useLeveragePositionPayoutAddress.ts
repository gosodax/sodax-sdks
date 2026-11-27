import type { Address, SpokeChainKey } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';

export type UseLeveragePositionPayoutAddressParams = {
  chainKey: SpokeChainKey;
  /** Supplied by the caller: this package has no wallet layer to read the connected account. */
  signerAddress: Address | undefined;
  /** The position's owner, from `useGetUserHubWalletAddress`. */
  owner: Address | undefined;
};

/**
 * Hub address a position withdrawal can pay to: the signer on the hub chain, else the hub wallet (owner).
 * `undefined` while resolving means disable withdraw — do not fall back to the signer.
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
