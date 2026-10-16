import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { ChainType } from '@sodax/types';
import { useXWalletStore } from '@/useXWalletStore.js';

type SignMessageReturnType = `0x${string}` | Uint8Array | string | undefined;

export type XSignMessageVariables = {
  xChainType: ChainType;
  message: string;
};

/**
 * React Query mutation that delegates message signing to the connected wallet via
 * `ChainActions.signMessage` — registered per chain by the `chainRegistry` (non-provider
 * chains) or by the `<Chain>Actions` component (provider-managed chains).
 *
 * The signature shape varies by chain: hex `\`0x${string}\`` for EVM, base64 `string` for
 * Stellar/Solana/Sui, etc. Branch on `xChainType` when consuming.
 *
 * **Bitcoin auto-selects** between BIP-322 (P2WPKH/P2TR) and ECDSA (P2SH/P2PKH) based
 * on the connected address type — same dispatch logic as the SDK's
 * `RadfiProvider.authenticateWithWallet`.
 *
 * **Returns `undefined`** when the chain doesn't implement `signMessage` — currently
 * ICON (Hana wallet exposes no signing API), NEAR and Stacks. A `console.warn`
 * accompanies each such call; there is no dedupe.
 *
 * @see {@link https://github.com/icon-project/sodax-sdks/blob/main/packages/wallet-sdk-react/docs/SIGN_MESSAGE.md | Sign Message}
 */
export function useXSignMessage(): UseMutationResult<SignMessageReturnType, Error, XSignMessageVariables, unknown> {
  const actionsRegistry = useXWalletStore(state => state.chainActions);

  return useMutation({
    mutationFn: async ({ xChainType, message }: XSignMessageVariables) => {
      const chainActions = actionsRegistry[xChainType];
      if (!chainActions?.signMessage) {
        console.warn(`[useXSignMessage] signMessage not supported for chain "${xChainType}"`);
        return undefined;
      }
      return await chainActions.signMessage(message);
    },
  });
}
