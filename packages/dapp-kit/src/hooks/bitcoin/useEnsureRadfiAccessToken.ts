import type { IBitcoinWalletProvider } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';
import { loadRadfiSession, saveRadfiSession } from './useRadfiAuth.js';

export type UseEnsureRadfiAccessTokenVars = {
  walletProvider: IBitcoinWalletProvider;
};

/**
 * Bound tokens are short-lived: call right before a Bitcoin-source createIntent and pass the token as
 * `extras.bound.accessToken` (SDK) or the `accessToken` body field (backend). Falls back to BIP322 re-auth.
 */
export function useEnsureRadfiAccessToken({
  mutationOptions,
}: MutationHookParams<string, UseEnsureRadfiAccessTokenVars> = {}): SafeUseMutationResult<
  string,
  Error,
  UseEnsureRadfiAccessTokenVars
> {
  const { sodax } = useSodaxContext();
  return useSafeMutation<string, Error, UseEnsureRadfiAccessTokenVars>({
    mutationKey: ['bitcoin', 'ensureAccessToken'],
    ...mutationOptions,
    mutationFn: async ({ walletProvider }) => {
      const radfi = sodax.spoke.bitcoin.radfi;
      const walletAddress = await walletProvider.getWalletAddress();
      // Seed in-memory tokens from the saved session so a refresh can run without a re-sign popup.
      const session = loadRadfiSession(walletAddress);
      if (session?.refreshToken && !radfi.refreshToken) {
        radfi.setRadfiAccessToken(session.accessToken, session.refreshToken);
      }
      await radfi.ensureRadfiAccessToken(walletProvider);
      const accessToken = radfi.accessToken;
      if (!accessToken) {
        throw new Error('Failed to obtain a Bound Exchange access token');
      }
      // Persist refreshed tokens so a later reload can refresh again without re-signing.
      if (session) {
        saveRadfiSession(walletAddress, { ...session, accessToken, refreshToken: radfi.refreshToken });
      }
      return accessToken;
    },
  });
}
