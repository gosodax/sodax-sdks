import { useMemo } from 'react';

import type { ChainType, SpokeChainKey } from '@sodax/types';

import type { XAccount } from '@/types/index.js';
import { assert } from '@/shared/guards.js';
import { getXChainType } from '@/actions/index.js';
import { useXConnection } from './useXConnection.js';

export type UseXAccountOptions =
  | { xChainId: SpokeChainKey; xChainType?: never }
  | { xChainType: ChainType; xChainId?: never };

/**
 * Returns the connected `XAccount` for a chain family.
 *
 * Pass either `xChainId` (a `SpokeChainKey` — auto-resolved to its family) or
 * `xChainType` (a `ChainType` directly), never both. EVM is family-level — wagmi
 * maintains a single connection across every configured EVM network.
 *
 * Always returns a populated object, never `undefined`. When no wallet is connected,
 * `address` is `undefined` but `xChainType` is filled — consumers can render
 * `account.address ?? <ConnectCta />` without null-checking the wrapper.
 *
 * @see {@link https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md#read-connected-account-state | Connect Flow — Read state}
 */
export function useXAccount({ xChainId, xChainType }: UseXAccountOptions): XAccount {
  assert(!(xChainId && xChainType), '[useXAccount] pass either xChainId or xChainType, not both');
  assert(xChainId || xChainType, '[useXAccount] pass xChainId or xChainType');

  const target = xChainType ?? getXChainType(xChainId);
  const xConnection = useXConnection({ xChainType: target });

  return useMemo(
    (): XAccount => xConnection?.xAccount ?? { address: undefined, xChainType: target },
    [target, xConnection],
  );
}
