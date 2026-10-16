import type { ChainType, GetChainType, GetWalletProviderType, IWalletProvider, SpokeChainKey } from '@sodax/types';
import { assert } from '@/shared/guards.js';
import { getXChainType } from '@/actions/index.js';
import { useXWalletStore, type GetWalletProviderReturnType } from '@/useXWalletStore.js';
import { shouldWarnChainDisabled } from './warnChainDisabled.js';

export type UseWalletProviderOptions = {
  xChainId?: SpokeChainKey;
  xChainType?: ChainType;
};

const warnedChains = new Set<ChainType>();

/**
 * Returns the typed `IXxxWalletProvider` instance for the requested chain — ready to plug
 * into any `@sodax/sdk` call's `walletProvider` slot.
 *
 * Pass either `xChainId` (a `SpokeChainKey`) or `xChainType` (a `ChainType` family),
 * never both. The chain key form gives the narrowest TypeScript inference (e.g.
 * `xChainId: ChainKeys.BSC_MAINNET` → `IEvmWalletProvider | undefined`).
 *
 * Returns `undefined` when:
 * - The chain isn't enabled in `SodaxWalletProvider` config (logs a one-time warning).
 * - No wallet is connected for that chain yet.
 *
 * For provider-managed chains (EVM/Solana/Sui), the returned provider is rebuilt by the
 * Hydrator whenever the underlying client changes (chain switch, wallet swap). For
 * non-provider chains, the provider is created as a side-effect of `setXConnection`.
 *
 * @see {@link https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/WALLET_PROVIDER_BRIDGE.md | Wallet Provider Bridge}
 */
export function useWalletProvider<S extends SpokeChainKey>(options: {
  xChainId: S;
  xChainType?: never;
}): GetWalletProviderType<GetChainType<S>> | undefined;
export function useWalletProvider<K extends ChainType | undefined>(options?: {
  xChainId?: never;
  xChainType?: K;
}): GetWalletProviderReturnType<K> | undefined;
export function useWalletProvider({
  xChainId,
  xChainType,
}: UseWalletProviderOptions = {}): IWalletProvider | undefined {
  assert(!(xChainId && xChainType), '[useWalletProvider] pass either xChainId or xChainType, not both');
  const target = xChainType ?? (xChainId ? getXChainType(xChainId) : undefined);

  return useXWalletStore(state => {
    if (!target) return undefined;
    if (shouldWarnChainDisabled(target, state, warnedChains)) {
      console.warn(
        `[useWalletProvider] chain "${target}" is not enabled in SodaxWalletProvider config.chains — returning undefined`,
      );
    }
    return state.getWalletProvider(target);
  });
}
