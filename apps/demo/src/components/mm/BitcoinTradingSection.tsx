import React from 'react';
import { useBitcoinBalance, ChainKeys, type IBitcoinWalletProvider } from '@sodax/dapp-kit';
import { useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { BitcoinSetupPanel } from '@/components/bitcoin/BitcoinSetupPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const noop = () => {};

/**
 * Money-market BTC funds live in the Bound Exchange trading wallet, not the personal wallet.
 * This section lets the user sign in to Bound Exchange, fund/withdraw the trading wallet, and
 * renew expired UTXOs — a prerequisite for every BTC supply / withdraw / borrow / repay.
 * Renders nothing until a Bitcoin wallet is connected.
 */
export function BitcoinTradingSection() {
  const walletProvider = useWalletProvider({ xChainId: ChainKeys.BITCOIN_MAINNET }) as
    | IBitcoinWalletProvider
    | undefined;
  const { address } = useXAccount({ xChainId: ChainKeys.BITCOIN_MAINNET });
  const { data: nativeBalance, isLoading: isNativeBalanceLoading } = useBitcoinBalance({ params: { address } });

  if (!walletProvider) return null;

  return (
    <Card className="my-3">
      <CardHeader className="pb-0">
        <CardTitle>Bitcoin Trading Wallet</CardTitle>
        <p className="text-sm text-clay font-normal">
          Supply, withdraw, borrow and repay BTC route through this Bound Exchange trading wallet. Sign in and top it up
          before using BTC in the money market.
        </p>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pt-0">
        <BitcoinSetupPanel
          walletProvider={walletProvider}
          onReadyChange={noop}
          nativeBalance={nativeBalance}
          isNativeBalanceLoading={isNativeBalanceLoading}
        />
      </CardContent>
    </Card>
  );
}
