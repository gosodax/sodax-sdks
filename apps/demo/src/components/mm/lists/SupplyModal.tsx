import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TokenIcon } from '@/components/shared/TokenIcon';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { Skeleton } from '@/components/ui/skeleton';

import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { formatUnits, parseUnits } from 'viem';
import {
  useMMAllowance,
  useMMApprove,
  useSodaxContext,
  useSupply,
  useBalances,
  type SpokeChainKey,
  type XToken,
  type MoneyMarketSupplyParams,
} from '@sodax/dapp-kit';
import { useAppStore } from '@/zustand/useAppStore';
import { useBtcTradingBalance } from '@/hooks/useBtcTradingBalance';
import {
  formatDecimalForDisplay,
  getChainsWithThisToken,
  getMmErrorText,
  getNativeTokenSymbol,
  getSafeMaxAmountForInput,
  getTokenOnChain,
} from '@/lib/utils';
import { logger } from '@/lib/logger';
import { ErrorAlert } from '../ErrorAlert';
import { extractTxHash } from '@/lib/extractTxHash';
import { getChainName } from '@/constants';
import { ActionSuccessContent, type ActionSuccessData } from './ActionSuccessContent';
import { Loader2 } from 'lucide-react';

interface SupplyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: XToken;
  // If true, shows success screen inline instead of closing and calling onSuccess.
  inlineSuccess?: boolean; // Called on success. Only used when inlineSuccess is false.
  onSuccess?: (data: {
    amount: string;
    token: XToken;
    sourceChainId: SpokeChainKey;
    destinationChainId: SpokeChainKey;
    txHash?: string;
  }) => void;
}

export function SupplyModal({ open, onOpenChange, token, onSuccess, inlineSuccess }: SupplyModalProps) {
  const [amount, setAmount] = useState('');
  // UI state: tracks whether to show form or success screen within the same dialog
  const [step, setStep] = useState<'form' | 'success'>('form');
  // Stores success data (amount, token, txHash) when transaction completes, for displaying success screen
  const [successData, setSuccessData] = useState<ActionSuccessData | null>(null);
  const { selectedChainId, openWalletModal, isWalletModalOpen } = useAppStore();
  const { sodax } = useSodaxContext();

  const dstChainKey = selectedChainId;
  const [srcChainKey, setSrcChainKey] = useState<SpokeChainKey>(selectedChainId);

  const supportedSourceChains = getChainsWithThisToken(sodax, token);
  // Falls back to the originally-selected token so the rest of the form keeps rendering, but only
  // `sourceTokenOnChain` may reach the balance read below — the SDK reads the chain named by
  // `chainKey` and never consults `token.chainKey`, so a token from a different chain reads as
  // `0n` with no error, i.e. a wrong balance rather than a caught mistake.
  const sourceTokenOnChain = getTokenOnChain(sodax, token.symbol, srcChainKey);
  const sourceToken = sourceTokenOnChain ?? token;

  const { address: srcAddress } = useXAccount({ xChainId: srcChainKey });
  const { address: dstAddress } = useXAccount({ xChainId: dstChainKey });

  const sourceWalletProvider = useWalletProvider({ xChainId: srcChainKey });

  const { data: sourceBalances, isLoading: isBalanceLoading } = useBalances({
    params: { chainKey: srcChainKey, tokens: sourceTokenOnChain ? [sourceTokenOnChain] : [], address: srcAddress },
  });

  const { mutateAsync: supply, isPending, error, reset: resetSupply } = useSupply();

  // On Bitcoin the deposit is pulled from the Bound Exchange trading wallet, so the spendable max
  // is the trading-wallet balance, not the personal wallet's UTXO balance.
  const { isBitcoin, tradingBalanceSats, notReady: btcNotReady } = useBtcTradingBalance({ chainId: srcChainKey });

  const isSameChain = srcChainKey === dstChainKey;

  const parsedAmount: number | undefined = useMemo(() => {
    const rawParsedAmount = Number.parseFloat(amount);
    if (Number.isNaN(rawParsedAmount) || rawParsedAmount < 0) return undefined;
    return rawParsedAmount;
  }, [amount]);

  const parsedMaxAmount: number | undefined = useMemo(() => {
    if (isBitcoin) {
      const num = Number(formatUnits(tradingBalanceSats, 8));
      return Number.isFinite(num) && num >= 0 ? num : undefined;
    }
    if (!sourceToken || !sourceBalances) return undefined;
    const raw = sourceBalances[sourceToken.address] ?? 0n;
    const num = Number(formatUnits(raw, sourceToken.decimals));
    if (!Number.isFinite(num) || num < 0) return undefined;
    return num;
  }, [isBitcoin, tradingBalanceSats, sourceBalances, sourceToken]);

  const exceedsMaxSupply =
    parsedAmount !== undefined && parsedMaxAmount !== undefined && parsedAmount > parsedMaxAmount;

  const params: MoneyMarketSupplyParams | undefined = useMemo(() => {
    if (!parsedAmount || exceedsMaxSupply || !srcAddress || !sourceToken || !dstAddress) return undefined;

    const crossChainParams = isSameChain ? {} : { dstChainKey, dstAddress };

    return {
      srcChainKey,
      srcAddress,
      token: sourceToken.address,
      amount: parseUnits(amount, sourceToken.decimals),
      action: 'supply',
      ...crossChainParams,
    };
  }, [
    amount,
    parsedAmount,
    exceedsMaxSupply,
    srcAddress,
    sourceToken,
    srcChainKey,
    dstChainKey,
    dstAddress,
    isSameChain,
  ]);

  const { data: hasAllowed, isLoading: isAllowanceLoading } = useMMAllowance({ params: { payload: params } });
  const {
    mutateAsync: approve,
    isPending: isApproving,
    error: approveError,
    reset: resetApproveError,
  } = useMMApprove();

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChainKey });

  const handleSupply = async (): Promise<void> => {
    if (!sourceWalletProvider || !params) return;

    try {
      const result = await supply({ params, walletProvider: sourceWalletProvider });

      const nextSuccessData: ActionSuccessData = {
        amount,
        token,
        sourceChainId: srcChainKey,
        destinationChainId: dstChainKey,
        txHash: extractTxHash(result),
      };

      if (inlineSuccess) {
        setSuccessData(nextSuccessData);
        setStep('success');
      } else {
        onSuccess?.(nextSuccessData);
        onOpenChange(false);
      }
    } catch (err) {
      logger.error('Supply failed', err);
    }
  };

  const handleApprove = async (): Promise<void> => {
    if (!sourceWalletProvider || !params) return;

    try {
      await approve({ params, walletProvider: sourceWalletProvider });
    } catch (err) {
      logger.error('Approve failed', err);
    }
  };

  const handleMaxClick = (): void => {
    if (parsedMaxAmount === undefined) return;
    setAmount(getSafeMaxAmountForInput(parsedMaxAmount.toString()));
  };

  const handleOpenChangeInternal = (nextOpen: boolean) => {
    if (!nextOpen && isWalletModalOpen) {
      return;
    }
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setAmount('');
      setStep('form');
      setSuccessData(null);
      setSrcChainKey(selectedChainId);
      resetSupply?.();
      resetApproveError?.();
    }
  };

  // Button state machine: prioritize pending states to prevent flickering
  // When a transaction is pending, show that state regardless of allowance checks
  const isBusy = isApproving || isPending;

  // Only check allowance when not busy (prevents flickering during transactions)
  // If allowance is unknown/loading and not busy, assume approval is needed
  const needsApproval = !isBusy && (hasAllowed === false || hasAllowed === undefined || isAllowanceLoading);
  const hasAllowance = !isBusy && hasAllowed === true;

  // Show success screen instead of form when transaction completes and inlineSuccess is enabled
  if (inlineSuccess && step === 'success' && successData) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChangeInternal} modal={!isWalletModalOpen}>
        <DialogContent className="sm:max-w-sm border-cherry-grey/20">
          <ActionSuccessContent action="supply" data={successData} onClose={() => onOpenChange(false)} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChangeInternal} modal={!isWalletModalOpen}>
      <DialogContent className="sm:max-w-md border-cherry-grey/20">
        <DialogHeader>
          <DialogTitle className="text-center text-cherry-dark">Supply {token.symbol}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Supply from</Label>
            <ChainSelector
              selectedChainId={srcChainKey}
              selectChainId={setSrcChainKey}
              allowedChains={supportedSourceChains}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-cherry-dark">
                {isSameChain ? 'Same-chain' : 'Cross-chain'}
              </span>
              <span className="text-xs text-muted-foreground">
                {isSameChain
                  ? `Supply ${token.symbol} on ${getChainName(srcChainKey) || srcChainKey}`
                  : `Supply ${token.symbol} on ${getChainName(srcChainKey) || srcChainKey} to a position on ${
                      getChainName(dstChainKey) || dstChainKey
                    }`}
              </span>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <div className="flex items-center gap-2">
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={isBusy}
              />
              <span className="flex items-center gap-1">
                <TokenIcon symbol={token.symbol} className="h-4 w-4" />
                {token.symbol}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleMaxClick}
                disabled={isBusy || parsedMaxAmount === undefined}
              >
                Max
              </Button>
            </div>

            <div className="space-y-1">
              {isBalanceLoading ? (
                <Skeleton className="h-4 w-40" />
              ) : (
                parsedMaxAmount !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Max supply: {formatDecimalForDisplay(parsedMaxAmount.toString(), 4)} {token.symbol}
                  </p>
                )
              )}
              {exceedsMaxSupply && !isBusy && parsedMaxAmount !== undefined && (
                <ErrorAlert
                  text={`Amount exceeds maximum supply: ${formatDecimalForDisplay(parsedMaxAmount.toString(), 4)} ${token.symbol}`}
                  variant="compact"
                />
              )}
            </div>
          </div>
        </div>

        {error && <ErrorAlert text={getMmErrorText(error)} />}
        {approveError && <ErrorAlert text={getMmErrorText(approveError)} />}

        {btcNotReady && (
          <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
            Sign in and top up the <strong>Bitcoin Trading Wallet</strong> section on the Money Market page before
            supplying BTC.
          </p>
        )}

        {!isWrongChain && !!srcAddress && !!parsedAmount && (
          <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
            Make sure you have enough <strong>{getNativeTokenSymbol(srcChainKey)}</strong> on{' '}
            <strong>{getChainName(srcChainKey) || srcChainKey}</strong> to cover gas fees for this transaction.
          </p>
        )}

        <DialogFooter className="sm:justify-start flex-col gap-2">
          {isWrongChain ? (
            <Button className="w-full" variant="cherry" onClick={handleSwitchChain} disabled={isBusy}>
              Switch to {getChainName(srcChainKey) || srcChainKey}
            </Button>
          ) : !srcAddress ? (
            <Button className="w-full" variant="cherry" onClick={openWalletModal}>
              Connect Wallet on {getChainName(srcChainKey) || srcChainKey}
            </Button>
          ) : isPending ? (
            // Always show "Supplying..." when supply transaction is pending (prevents flickering)
            <Button className="w-full" disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Supplying...
            </Button>
          ) : isApproving ? (
            // Show "Approving..." when approval transaction is pending
            <Button className="w-full" disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Approving...
            </Button>
          ) : needsApproval ? (
            <Button
              className="w-full"
              type="button"
              variant="cherrySoda"
              onClick={handleApprove}
              disabled={!params || !sourceWalletProvider}
            >
              Approve
            </Button>
          ) : hasAllowance ? (
            <Button
              className="w-full"
              type="button"
              variant="default"
              onClick={handleSupply}
              disabled={!params || !sourceWalletProvider || !amount || btcNotReady}
            >
              Supply {token.symbol}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
