import {
  ChainKeys,
  type IBitcoinWalletProvider,
  type IWalletProvider,
  type RadfiWalletBalance,
  type SpokeChainKey,
} from '@sodax/sdk';
import { useTradingWallet } from './useTradingWallet.js';
import { useTradingWalletBalance } from './useTradingWalletBalance.js';

export interface UseBitcoinTradingSetupParams {
  chainKey: SpokeChainKey;
  walletProvider: IWalletProvider | undefined;
  address: string | undefined;
}

export interface BitcoinTradingSetup {
  wallet: IBitcoinWalletProvider | undefined;
  tradingBalance: RadfiWalletBalance | undefined;
}

const INERT: BitcoinTradingSetup = { wallet: undefined, tradingBalance: undefined };

/**
 * Bitcoin funds move through a Bound (Radfi) trading wallet; inert unless `chainKey` is Bitcoin.
 * Wallet inputs are passed in because this package must not depend on wallet-sdk-react.
 */
export function useBitcoinTradingSetup({
  chainKey,
  walletProvider,
  address,
}: UseBitcoinTradingSetupParams): BitcoinTradingSetup {
  const isBitcoin = chainKey === ChainKeys.BITCOIN_MAINNET;
  // Safe: when this side is Bitcoin its provider IS the Bitcoin one (TS can't relate chainKey to provider type).
  const wallet = isBitcoin ? (walletProvider as IBitcoinWalletProvider | undefined) : undefined;

  // Hooks run every render; undefined inputs keep the Bound balance query disabled when not Bitcoin.
  const { tradingAddress } = useTradingWallet(isBitcoin ? address : undefined);
  const { data: tradingBalance } = useTradingWalletBalance({ params: { walletProvider: wallet, tradingAddress } });

  if (!isBitcoin) return INERT;
  return { wallet, tradingBalance };
}
