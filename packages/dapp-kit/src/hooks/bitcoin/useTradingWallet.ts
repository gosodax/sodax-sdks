import { loadRadfiSession } from './useRadfiAuth.js';

type UseTradingWalletReturn = {
  tradingAddress: string | undefined;
};

/** Reads the trading address from the persisted session (created during auth); no API call. */
export function useTradingWallet(walletAddress: string | undefined): UseTradingWalletReturn {
  if (!walletAddress) return { tradingAddress: undefined };
  const session = loadRadfiSession(walletAddress);
  return { tradingAddress: session?.tradingAddress || undefined };
}
