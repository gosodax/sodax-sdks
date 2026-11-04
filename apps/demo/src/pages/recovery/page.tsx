import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/zustand/useAppStore';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Wallet, CheckCircle2, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { useXAccount, useWalletProvider, useEvmSwitchChain } from '@sodax/wallet-sdk-react';
import {
  useGetUserHubWalletAddress,
  useHubAssetBalances,
  useWithdrawHubAsset,
  type HubAssetBalance,
  baseChainInfo,
} from '@sodax/dapp-kit';
import { formatTokenAmount, getChainExplorerTxUrl, getReadableTxError } from '@/lib/utils';
import type { Address } from 'viem';

type WithdrawResult = {
  success: boolean;
  txHash?: string;
  error?: string;
};

export default function RecoveryPage() {
  const { selectedChainId, selectChainId, openWalletModal } = useAppStore();
  const xAccount = useXAccount({ xChainId: selectedChainId });
  const walletProvider = useWalletProvider({ xChainId: selectedChainId });
  const srcAddress = xAccount?.address as Address | undefined;
  const { data: hubWalletAddress } = useGetUserHubWalletAddress({
    params: { spokeChainId: selectedChainId, spokeAddress: srcAddress },
  });
  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: selectedChainId });

  const [withdrawResults, setWithdrawResults] = useState<Record<string, WithdrawResult>>({});
  const [isWithdrawingAll, setIsWithdrawingAll] = useState(false);
  const [withdrawingAssets, setWithdrawingAssets] = useState<Set<string>>(new Set());

  const allowedChains = useMemo(
    () =>
      Object.values(baseChainInfo)
        .filter(chain => chain.type === 'EVM')
        .map(chain => chain.key),
    [],
  );

  const {
    data: balances,
    isFetching: isLoadingBalances,
    error: balancesError,
    refetch: refetchBalances,
  } = useHubAssetBalances({
    params: { chainKey: selectedChainId, srcAddress },
  });

  const balanceError = balancesError ? getReadableTxError(balancesError) : null;

  const { mutateAsync: withdrawHubAsset } = useWithdrawHubAsset();

  // Reset per-chain UI state when chain changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedChainId is the intentional trigger to reset state
  useEffect(() => {
    setWithdrawResults({});
    setWithdrawingAssets(new Set());
    setIsWithdrawingAll(false);
  }, [selectedChainId]);

  const handleWithdrawAsset = useCallback(
    async (asset: HubAssetBalance) => {
      if (!walletProvider || !srcAddress) return;

      setWithdrawingAssets(prev => new Set(prev).add(asset.spokeTokenAddress));

      try {
        const txHash = await withdrawHubAsset({
          params: {
            srcChainKey: selectedChainId,
            srcAddress,
            token: asset.spokeTokenAddress,
            amount: asset.balance,
          },
          walletProvider,
        });
        setWithdrawResults(prev => ({
          ...prev,
          [asset.spokeTokenAddress]: { success: true, txHash: txHash as string },
        }));
      } catch (error) {
        setWithdrawResults(prev => ({
          ...prev,
          [asset.spokeTokenAddress]: { success: false, error: getReadableTxError(error) },
        }));
      }

      setWithdrawingAssets(prev => {
        const next = new Set(prev);
        next.delete(asset.spokeTokenAddress);
        return next;
      });
    },
    [walletProvider, srcAddress, selectedChainId, withdrawHubAsset],
  );

  const handleWithdrawAll = useCallback(async () => {
    if (!balances || balances.length === 0) return;
    setIsWithdrawingAll(true);

    // Sequential by design: each withdraw is a relay tx that consumes nonce on the source chain;
    // parallelising would race the wallet's nonce manager and produce nonce-replacement errors.
    for (const asset of balances) {
      if (withdrawResults[asset.spokeTokenAddress]?.success) continue;
      await handleWithdrawAsset(asset);
    }

    setIsWithdrawingAll(false);
    await refetchBalances();
  }, [balances, withdrawResults, handleWithdrawAsset, refetchBalances]);

  const pendingWithdrawCount = balances?.filter(a => !withdrawResults[a.spokeTokenAddress]?.success).length ?? 0;

  return (
    <main className="min-h-screen bg-linear-to-br from-almost-white via-cream-white to-vibrant-white">
      <div className="container mx-auto px-4 py-4 max-w-7xl">
        <div className="my-3">
          <h1 className="text-4xl font-bold text-cherry-dark">Recovery</h1>
          <p className="text-clay">Withdraw assets stuck in your hub wallet back to your spoke chain wallet.</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-cherry-grey/20 p-3 my-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-clay">Chain:</span>
              <ChainSelector
                selectedChainId={selectedChainId}
                selectChainId={selectChainId}
                allowedChains={allowedChains}
              />
            </div>

            {hubWalletAddress && (
              <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2 text-sm">
                <span className="text-clay">Hub Wallet:</span>
                <span className="px-3 py-1.5 bg-cream rounded-lg text-cherry-dark text-xs font-mono break-all">
                  {hubWalletAddress}
                </span>
              </div>
            )}
          </div>
        </div>

        {srcAddress ? (
          <Card className="animate-in fade-in duration-500">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-cherry-dark">Hub Wallet Assets</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="cherryOutline"
                  size="sm"
                  onClick={() => refetchBalances()}
                  disabled={isLoadingBalances || !hubWalletAddress}
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingBalances ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                {balances && balances.length > 0 && pendingWithdrawCount > 0 && (
                  <Button
                    variant="cherry"
                    size="sm"
                    onClick={handleWithdrawAll}
                    disabled={isWithdrawingAll || isWrongChain || withdrawingAssets.size > 0}
                  >
                    {isWithdrawingAll ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Withdrawing...
                      </>
                    ) : (
                      `Withdraw All (${pendingWithdrawCount})`
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="px-4 sm:px-6">
              {isWrongChain && (
                <div className="flex flex-wrap items-center gap-3 p-3 mb-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-yellow-600" />
                  <span className="text-sm text-yellow-800">Your wallet is connected to a different network.</span>
                  <Button variant="cherry" size="sm" onClick={handleSwitchChain}>
                    Switch Network
                  </Button>
                </div>
              )}

              {balanceError && (
                <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 wrap-anywhere">
                  {balanceError}
                </div>
              )}

              {isLoadingBalances && !balances ? (
                <div className="flex items-center justify-center py-12 text-clay">
                  <Loader2 className="w-6 h-6 animate-spin mr-2" />
                  Loading hub wallet balances...
                </div>
              ) : balances && balances.length === 0 ? (
                <div className="text-center py-12 text-clay">No recoverable assets found for this chain.</div>
              ) : balances && balances.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Hub Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {balances.map(asset => {
                      const result = withdrawResults[asset.spokeTokenAddress];
                      const isWithdrawing = withdrawingAssets.has(asset.spokeTokenAddress);

                      return (
                        <TableRow key={asset.spokeTokenAddress}>
                          <TableCell>
                            <div>
                              <span className="font-medium text-cherry-dark">{asset.symbol}</span>
                              <span className="text-xs text-clay ml-2">{asset.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono">
                            {formatTokenAmount(asset.balance, asset.decimal, 6)}
                          </TableCell>
                          <TableCell>
                            {result?.success ? (
                              <div className="flex items-center gap-1 text-green-600 text-sm">
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Withdrawn</span>
                                {result.txHash && (
                                  <>
                                    {' - '}
                                    <a
                                      href={getChainExplorerTxUrl(selectedChainId, result.txHash)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline"
                                    >
                                      tx
                                    </a>
                                  </>
                                )}
                              </div>
                            ) : result?.error ? (
                              <span className="text-red-600 text-sm">{result.error}</span>
                            ) : isWithdrawing ? (
                              <div className="flex items-center gap-1 text-clay text-sm">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Processing...
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="cherryOutline"
                              size="sm"
                              onClick={() => handleWithdrawAsset(asset)}
                              disabled={isWithdrawing || result?.success || isWrongChain || isWithdrawingAll}
                            >
                              {isWithdrawing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : result?.success ? (
                                'Done'
                              ) : result?.error ? (
                                'Retry'
                              ) : (
                                'Withdraw'
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : !hubWalletAddress ? (
                <div className="text-center py-12 text-clay">Deriving hub wallet address...</div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[320px] sm:min-h-[500px] bg-white rounded-xl shadow-sm border border-cherry-grey/20 p-6 sm:p-12">
            <div className="max-w-md text-center space-y-6">
              <div className="w-15 h-15 bg-cherry-brighter rounded-full flex items-center justify-center mx-auto">
                <Wallet className="w-8 h-8 text-cherry-dark" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-cherry-dark mb-2">Connect Your Wallet</h2>
                <p className="text-clay">Connect your wallet to check for recoverable assets in your hub wallet</p>
              </div>
              <Button onClick={openWalletModal} variant="cherry" size="lg" className="px-8">
                Connect Wallet
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
