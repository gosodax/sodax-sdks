/**
 * Binds the dapp-kit position hooks to this app's wallet layer.
 *
 * Thin on purpose. The operations themselves — routing calls as the owning hub wallet, and reporting
 * the intents that need reporting — now live in `@sodax/dapp-kit`, which is where an integrator
 * finds them. What cannot live there is the wallet: dapp-kit is built not to depend on
 * `@sodax/wallet-sdk-react`, so the provider and signer are supplied by the app. That binding is
 * this file, and it keeps the call sites reading the way they did.
 *
 * WHICH HOOK FOR WHICH CALL is not a style choice. `increaseLeverage` and `decreaseLeverage` only
 * POST an intent that a solver fills later, and an unreported one expires unfilled — so they go
 * through `useSubmitPositionIntent`. `withdraw`, `settle` and `cancel` are synchronous on the hub
 * and need no notification; they go through `useRunPositionOperation`.
 */

import { useCallback } from 'react';
import type { Hex } from 'viem';
import {
  useRunLeveragePositionOperation,
  useSubmitLeveragePositionIntent,
  type GetWalletProviderType,
  type LeveragePositionIntentResult,
  type PositionDirectCall,
  type PositionIntentCall,
  type SpokeChainKey,
  type TxHashPair,
} from '@sodax/dapp-kit';
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';

/** The provider cast the SDK validates against `chain`, so a mismatch fails before signing. */
function useSigning(chain: SpokeChainKey) {
  const walletProvider = useWalletProvider({ xChainId: chain });
  const signer = useXAccount({ xChainId: chain }).address;
  return { walletProvider: walletProvider as GetWalletProviderType<typeof chain>, signer };
}

/** Runs `withdraw` / `settle` / `cancel` as the hub wallet. No intent, so nothing to notify. */
export function useRunPositionOperation(chain: SpokeChainKey): {
  signer: string | undefined;
  route: (calls: readonly PositionDirectCall[]) => Promise<TxHashPair>;
} {
  const { walletProvider, signer } = useSigning(chain);
  const { mutateAsync } = useRunLeveragePositionOperation();

  const route = useCallback(
    async (calls: readonly PositionDirectCall[]) => {
      if (!signer) throw new Error('Connect a wallet');
      return mutateAsync({ params: { srcChainKey: chain, srcAddress: signer, calls }, walletProvider });
    },
    [mutateAsync, chain, signer, walletProvider],
  );

  return { signer, route };
}

/** Posts an `increaseLeverage` / `decreaseLeverage` intent and reports it to the solver. */
export function useSubmitPositionIntent(
  chain: SpokeChainKey,
): (params: { calls: readonly PositionIntentCall[] }) => Promise<{ hash: Hex; notified: boolean; error?: string }> {
  const { walletProvider, signer } = useSigning(chain);
  const { mutateAsync } = useSubmitLeveragePositionIntent();

  return useCallback(
    async ({ calls }) => {
      if (!signer) throw new Error('Connect a wallet');
      const result = await mutateAsync({
        params: { srcChainKey: chain, srcAddress: signer, calls },
        walletProvider,
      });
      return toLegacyShape(result);
    },
    [mutateAsync, chain, signer, walletProvider],
  );
}

/** The hub hash is where the intent lives; the call sites read a flat shape. */
function toLegacyShape(result: LeveragePositionIntentResult) {
  return {
    hash: result.txHashes.dstChainTxHash as Hex,
    notified: result.notified,
    error: result.notifyError,
  };
}

export { useLeveragePositionPayoutAddress } from '@sodax/dapp-kit';
