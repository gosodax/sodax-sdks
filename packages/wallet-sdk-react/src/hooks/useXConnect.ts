import type { XAccount } from '@/types/index.js';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { IXConnector } from '@/types/interfaces.js';
import { useXWalletStore } from '@/useXWalletStore.js';

/**
 * React Query mutation that connects a wallet via the supplied `IXConnector`.
 *
 * Pass an `IXConnector` (from `useXConnectors` / `useXConnectorsByChain`) to
 * `mutate` / `mutateAsync`. The hook delegates to the chain's `ChainActions.connect()`
 * and writes the resulting connection state into the store on success.
 *
 * **Provider-managed chains caveat** (EVM/Solana/Sui): the mutation resolves with
 * `undefined` because connection state is set reactively by the chain's Hydrator
 * after the native SDK reports `connected`. Read the resolved account via
 * `useXAccount` / `useXConnection`, not the mutation's return value.
 *
 * **Non-provider chains** (Bitcoin, ICON, Injective, Stellar, NEAR, Stacks) return
 * the resolved `XAccount` directly. Code defensively if your component supports
 * both — `useXAccount` works for both cases.
 *
 * Throws `Error('Chain "<X>" is not enabled or ChainActions not registered')` when
 * the connector's chain type isn't mounted in `SodaxWalletProvider` config.
 *
 * @see {@link https://github.com/gosodax/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/CONNECT_FLOW.md#connect-a-wallet | Connect Flow — Connect}
 */
export function useXConnect(): UseMutationResult<XAccount | undefined, Error, IXConnector> {
  const setXConnection = useXWalletStore(state => state.setXConnection);
  const actionsRegistry = useXWalletStore(state => state.chainActions);

  return useMutation({
    mutationFn: async (xConnector: IXConnector) => {
      const chainActions = actionsRegistry[xConnector.xChainType];
      if (!chainActions) {
        throw new Error(`Chain "${xConnector.xChainType}" is not enabled or ChainActions not registered`);
      }

      const xAccount = await chainActions.connect(xConnector.id);

      if (xAccount) {
        setXConnection(xConnector.xChainType, {
          xAccount,
          xConnectorId: xConnector.id,
        });
      }

      return xAccount;
    },
  });
}
