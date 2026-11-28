import { RadfiApiError, type IBitcoinWalletProvider } from '@sodax/sdk';
import { useSodaxContext } from '../shared/useSodaxContext.js';
import type { MutationHookParams } from '../shared/types.js';
import { useSafeMutation, type SafeUseMutationResult } from '../shared/useSafeMutation.js';

export type RadfiSession = {
  accessToken: string;
  refreshToken: string;
  tradingAddress: string;
  publicKey: string;
};

export type UseRadfiAuthVars = {
  walletProvider: IBitcoinWalletProvider;
};

type RadfiAuthResult = {
  accessToken: string;
  refreshToken: string;
  tradingAddress: string;
};

const SESSION_KEY = (address: string): string => `radfi_session_${address}`;

export function saveRadfiSession(address: string, session: RadfiSession): void {
  try {
    localStorage.setItem(SESSION_KEY(address), JSON.stringify(session));
  } catch {}
}

export function loadRadfiSession(address: string): RadfiSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY(address));
    return raw ? (JSON.parse(raw) as RadfiSession) : null;
  } catch {
    return null;
  }
}

export function clearRadfiSession(address: string): void {
  try {
    localStorage.removeItem(SESSION_KEY(address));
  } catch {}
}

/** Authenticates with Bound Exchange via a BIP322-signed message. */
export function useRadfiAuth({
  mutationOptions,
}: MutationHookParams<RadfiAuthResult, UseRadfiAuthVars> = {}): SafeUseMutationResult<
  RadfiAuthResult,
  Error,
  UseRadfiAuthVars
> {
  const { sodax } = useSodaxContext();
  return useSafeMutation<RadfiAuthResult, Error, UseRadfiAuthVars>({
    mutationKey: ['bitcoin', 'radfiAuth'],
    ...mutationOptions,
    mutationFn: async ({ walletProvider }) => {
      const radfi = sodax.spoke.bitcoin.radfi;
      const walletAddress = await walletProvider.getWalletAddress();
      const existingSession = loadRadfiSession(walletAddress);
      const cachedPublicKey = existingSession?.publicKey;

      try {
        const { accessToken, refreshToken, tradingAddress, publicKey } = await radfi.authenticateWithWallet(
          walletProvider,
          cachedPublicKey,
        );
        saveRadfiSession(walletAddress, { accessToken, refreshToken, tradingAddress, publicKey });
        return { accessToken, refreshToken, tradingAddress };
      } catch (err: unknown) {
        const isAlreadyRegistered = err instanceof RadfiApiError && err.code === '4008';

        if (isAlreadyRegistered && existingSession?.refreshToken) {
          try {
            const refreshed = await radfi.refreshAccessToken(existingSession.refreshToken);
            radfi.setRadfiAccessToken(refreshed.accessToken, refreshed.refreshToken);
            saveRadfiSession(walletAddress, {
              ...existingSession,
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
            });
            return {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              tradingAddress: existingSession.tradingAddress,
            };
          } catch {
            clearRadfiSession(walletAddress);
          }

          throw new Error(
            'This wallet is already registered with Bound Exchange from another session. ' +
              'Please clear your browser storage for this site and try again, ' +
              'or wait for the previous session to expire.',
          );
        }

        throw err;
      }
    },
  });
}
