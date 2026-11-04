import React, { type JSX, useMemo, useState } from 'react';
import {
  useUserReservesData,
  useReservesUsdFormat,
  useBackendAllMoneyMarketAssets,
  useUserFormattedSummary,
  useBalances,
  useSodaxContext,
  ChainKeys,
  type SpokeChainKey,
  type XToken,
} from '@sodax/dapp-kit';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useXAccount } from '@sodax/wallet-sdk-react';
import { BorrowAssetsListItem } from './BorrowAssetsListItem';
import { formatTokenAmount } from '@/lib/utils';
import { useBtcTradingBalance } from '@/hooks/useBtcTradingBalance';
import { getBorrowableAssetsWithMarketData } from '@/lib/borrowUtils';
import { BorrowModal } from '../BorrowModal';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { RepayModal } from '../RepayModal';
import { Info, Wallet } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useAppStore } from '@/zustand/useAppStore';
import { Button } from '@/components/ui/button';

const TABLE_HEADERS = [
  'Asset',
  'Wallet balance',
  'Available Liquidity',
  'Borrow APY',
  'Borrow APR',
  'Total Borrow',
  'Borrowed',
  'Actions',
];
type BorrowAssetsListProps = {
  initialChainId?: SpokeChainKey;
};

export function BorrowAssetsList({ initialChainId }: BorrowAssetsListProps): JSX.Element {
  const { openWalletModal } = useAppStore();
  const [selectedChainId, selectChainId] = useState<SpokeChainKey>(initialChainId ?? ChainKeys.AVALANCHE_MAINNET);
  const { sodax } = useSodaxContext();
  const [borrowData, setBorrowData] = useState<{
    token: XToken;
    maxBorrow: string;
    priceUSD: number;
  } | null>(null);
  const [repayData, setRepayData] = useState<{
    token: XToken;
    maxDebt: string;
  } | null>(null);

  const { address } = useXAccount({ xChainId: selectedChainId });

  const { data: allMoneyMarketAssets, isLoading: isAssetsLoading } = useBackendAllMoneyMarketAssets();

  const { selectedChainId: selectedPositionChainId } = useAppStore();
  const { address: positionAddress } = useXAccount({ xChainId: selectedPositionChainId });
  const { data: userReserves, isLoading: isUserReservesLoading } = useUserReservesData({
    params: { spokeChainKey: selectedPositionChainId, userAddress: positionAddress },
  });
  const { data: formattedReserves, isLoading: isFormattedReservesLoading } = useReservesUsdFormat();
  const { data: userSummary } = useUserFormattedSummary({
    params: { spokeChainKey: selectedPositionChainId, userAddress: positionAddress },
  });

  const borrowableAssets = useMemo(() => {
    if (!allMoneyMarketAssets) return [];
    const allBorrowableAssets = getBorrowableAssetsWithMarketData(sodax, allMoneyMarketAssets);

    const supportedOnChain = sodax.moneyMarket.getSupportedTokensByChainId(selectedChainId);

    return allBorrowableAssets.filter(
      asset => asset.chainId === selectedChainId && supportedOnChain.some(t => t.symbol === asset.token.symbol),
    );
  }, [sodax, allMoneyMarketAssets, selectedChainId]);

  // On Bitcoin the wallet balance shown is the Bound Exchange trading wallet, not the personal wallet.
  const { isBitcoin, tradingBalanceSats } = useBtcTradingBalance({ chainId: selectedChainId });

  const tokensOnSelectedChain = sodax.moneyMarket.getSupportedTokensByChainId(selectedChainId);
  const { data: balances } = useBalances({
    params: {
      chainKey: selectedChainId,
      tokens: tokensOnSelectedChain,
      address,
    },
  });

  const hasCollateral = !!userReserves?.[0]?.some(reserve => reserve.scaledATokenBalance > 0n);

  const isLoading = isUserReservesLoading || isFormattedReservesLoading || isAssetsLoading;

  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle>Assets to Borrow</CardTitle>
        <p className="text-sm text-clay font-normal">Borrow assets available on the selected chain.</p>

        {!hasCollateral && !isLoading && (
          <div className="mt-4 p-3 bg-cherry-brighter/20 border border-cherry-soda/30 rounded-lg flex items-start gap-2">
            <p className="text-sm text-cherry-soda font-medium">
              To borrow assets, first supply collateral in the Markets section above on any supported chain.
            </p>
          </div>
        )}
      </CardHeader>

      <div className="py-2 mx-2 my-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mx-4 sm:mx-6 pb-2">
          <span className="text-sm font-medium text-clay">Chain:</span>
          <ChainSelector selectedChainId={selectedChainId} selectChainId={selectChainId} />
          {address && (
            <div className="flex min-w-0 max-w-full items-center gap-2 sm:ml-2">
              <Wallet className="w-3.5 h-3.5 shrink-0 text-clay" />
              <span className="min-w-0 px-3 py-1.5 bg-cream rounded-lg text-cherry-dark text-xs break-all">
                {address}
              </span>
            </div>
          )}
        </div>
      </div>

      <CardContent className="p-0">
        {address ? (
          <div className="overflow-hidden">
            <div className="sm:max-h-[500px] overflow-y-auto">
              <Table unstyled className="w-full min-w-[56rem]">
                <TableHeader className="sticky top-0 bg-cream backdrop-blur-sm z-20 border-b border-cherry-grey/20">
                  <TableRow>
                    {TABLE_HEADERS.map((header, index) => {
                      if (header === 'Available Liquidity') {
                        return (
                          <TableHead
                            key={`${header}-${index}`}
                            className="text-xs font-medium text-clay uppercase tracking-wide px-6 py-4"
                          >
                            <div className="flex items-center gap-1">
                              {header}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="Available Liquidity Info"
                                    className="inline-flex items-center -m-1 p-1 text-clay hover:text-cherry-dark"
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent variant="soft" side="top" align="center" sideOffset={6}>
                                  The amount of tokens available in the pool that can be borrowed. This represents the
                                  unborrowed tokens in the money market, which may be limited by a borrow cap if one is
                                  set.
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableHead>
                        );
                      }

                      if (header === 'Borrow APY') {
                        return (
                          <TableHead
                            key={`${header}-${index}`}
                            className="text-xs font-medium text-clay uppercase tracking-wide px-4 py-4"
                          >
                            <div className="flex items-center gap-1">
                              {header}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="Borrow APY info"
                                    className="inline-flex items-center -m-1 p-1 text-clay hover:text-cherry-dark"
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent variant="soft" side="top" align="center" sideOffset={6}>
                                  Annual Percentage Yield is the effective annual interest rate you pay for borrowing
                                  assets, accounting for compound interest. This is the actual cost you'll pay over a
                                  year.
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableHead>
                        );
                      }

                      if (header === 'Borrow APR') {
                        return (
                          <TableHead
                            key={`${header}-${index}`}
                            className="text-xs font-medium text-clay uppercase tracking-wide px-6 py-4"
                          >
                            <div className="flex items-center gap-1">
                              {header}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label="Borrow APR info"
                                    className="inline-flex items-center -m-1 p-1 text-clay hover:text-cherry-dark"
                                  >
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent variant="soft" side="top" align="center" sideOffset={6}>
                                  Annual Percentage Rate is the simple annual interest rate you pay for borrowing
                                  assets, without compounding. APY accounts for compounding and is typically higher than
                                  APR.
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableHead>
                        );
                      }

                      return (
                        <TableHead
                          key={`${header}-${index}`}
                          className={`text-xs font-medium text-clay uppercase tracking-wide px-6 py-4 ${
                            header === 'Actions' ? 'text-center' : ''
                          }`}
                        >
                          {header}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-clay">
                        Loading borrowable assets...
                      </TableCell>
                    </TableRow>
                  ) : (
                    borrowableAssets.map((asset, index) => (
                      <BorrowAssetsListItem
                        key={`${asset.chainId}-${asset.address}-${index}`}
                        token={asset.token}
                        disabled={!hasCollateral}
                        walletBalance={
                          isBitcoin && asset.token?.chainKey === selectedChainId
                            ? // BTC funds live in the trading wallet (8-decimal sats), not the personal wallet
                              formatTokenAmount(tradingBalanceSats, 8, 6)
                            : asset.token?.chainKey === selectedChainId && balances?.[asset.token.address]
                              ? formatTokenAmount(balances[asset.token.address], asset.token.decimals, 6)
                              : '-'
                        }
                        formattedReserves={formattedReserves || []}
                        userReserves={userReserves?.[0] || []}
                        onBorrowClick={(token, maxBorrow, priceUSD) => {
                          setBorrowData({ token, maxBorrow, priceUSD });
                        }}
                        onRepayClick={(token, maxDebt) => {
                          setRepayData({ token, maxDebt });
                        }}
                        userSummary={userSummary}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[320px] sm:min-h-[500px] bg-white rounded-xl shadow-sm border border-cherry-grey/20 p-6 sm:p-12">
            <div className="max-w-md text-center space-y-6">
              <div className="w-15 h-15 bg-cherry-brighter rounded-full flex items-center justify-center mx-auto">
                <Wallet className="w-8 h-8 text-cherry-dark" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-cherry-dark mb-2">Connect Your Wallet</h2>
                <p className="text-clay">Connect your wallet to start borrowing and repaying assets</p>
              </div>
              <Button onClick={openWalletModal} variant="cherry" size="lg" className="px-8">
                Connect Wallet
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {borrowData && (
        <BorrowModal
          open={!!borrowData}
          token={borrowData.token}
          inlineSuccess={true}
          onOpenChange={open => {
            if (!open) setBorrowData(null);
          }}
          maxBorrow={borrowData.maxBorrow}
          priceUSD={borrowData.priceUSD}
          userSummary={userSummary}
        />
      )}

      {repayData && (
        <RepayModal
          open={true}
          token={repayData.token}
          maxDebt={repayData.maxDebt}
          srcChainId={selectedChainId}
          inlineSuccess={true}
          onOpenChange={open => {
            if (!open) setRepayData(null);
          }}
        />
      )}
    </Card>
  );
}
