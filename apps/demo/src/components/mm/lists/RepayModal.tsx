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
  useRepay,
  useSodaxContext,
  useBalances,
  type MoneyMarketRepayParams,
  type SpokeChainKey,
  type XToken,
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

interface RepayModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: XToken;
  maxDebt: string;
  srcChainId: SpokeChainKey;

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

export function RepayModal({
  open,
  onOpenChange,
  token,
  maxDebt,
  onSuccess,
  inlineSuccess,
  srcChainId,
}: RepayModalProps) {
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [successData, setSuccessData] = useState<ActionSuccessData | null>(null);
  const { selectedChainId, openWalletModal, isWalletModalOpen } = useAppStore();
  const { sodax } = useSodaxContext();

  const [srcChainKey, setSrcChainKey] = useState<SpokeChainKey>(srcChainId);
  const dstChainKey: SpokeChainKey = selectedChainId;

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

  const { mutateAsync: repay, isPending, error, reset: resetRepay } = useRepay();

  // On Bitcoin the repay deposit is pulled from the Bound Exchange trading wallet, so the spendable
  // balance is the trading-wallet balance, not the personal wallet's UTXO balance.
  const { isBitcoin, tradingBalanceSats, notReady: btcNotReady } = useBtcTradingBalance({ chainId: srcChainKey });

  const isSameChain = srcChainKey === dstChainKey;

  const parsedAmount: number | undefined = useMemo(() => {
    const rawParsedAmount = Number.parseFloat(amount);
    if (Number.isNaN(rawParsedAmount) || rawParsedAmount < 0) return undefined;
    return rawParsedAmount;
  }, [amount]);

  const parsedMaxBalance: number | undefined = useMemo(() => {
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

  const parsedMaxDebt: number | undefined = useMemo(() => {
    if (!maxDebt) return undefined;
    const num = Number.parseFloat(maxDebt);
    if (!Number.isFinite(num) || num < 0) return undefined;
    return num;
  }, [maxDebt]);

  const hasDebt = parsedMaxDebt !== undefined && parsedMaxDebt > 0;

  const exceedsMaxDebt = parsedAmount !== undefined && parsedMaxDebt !== undefined && parsedAmount > parsedMaxDebt;

  const insufficientBalance =
    parsedAmount !== undefined && parsedMaxBalance !== undefined && parsedAmount > parsedMaxBalance;

  const params: MoneyMarketRepayParams | undefined = useMemo(() => {
    if (!parsedAmount || exceedsMaxDebt || insufficientBalance || !srcAddress || !sourceToken) return undefined;
    if (!isSameChain && !dstAddress) return undefined;

    const crossChainParams = isSameChain ? {} : { dstChainKey, dstAddress };

    return {
      srcChainKey,
      srcAddress,
      token: sourceToken.address,
      amount: parseUnits(amount, sourceToken.decimals),
      action: 'repay',
      ...crossChainParams,
    };
  }, [
    amount,
    parsedAmount,
    exceedsMaxDebt,
    insufficientBalance,
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

  const handleRepay = async (): Promise<void> => {
    if (!sourceWalletProvider || !params) return;

    try {
      const result = await repay({ params, walletProvider: sourceWalletProvider });

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
      logger.error('Repay failed', err);
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
    if (!hasDebt || parsedMaxDebt === undefined) return;
    const cap = parsedMaxBalance !== undefined ? Math.min(parsedMaxDebt, parsedMaxBalance) : parsedMaxDebt;
    setAmount(getSafeMaxAmountForInput(cap.toString()));
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
      setSrcChainKey(dstChainKey);
      resetRepay?.();
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
          <ActionSuccessContent action="repay" data={successData} onClose={() => onOpenChange(false)} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChangeInternal} modal={!isWalletModalOpen}>
      <DialogContent className="sm:max-w-md border-cherry-grey/20">
        <DialogHeader>
          <DialogTitle className="text-center text-cherry-dark">Repay {token.symbol}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Repay from</Label>
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
                  ? `Repay ${token.symbol} on ${getChainName(srcChainKey) || srcChainKey}`
                  : `Repay ${token.symbol} from ${getChainName(srcChainKey) || srcChainKey} to your debt on ${
                      getChainName(dstChainKey) || dstChainKey
                    }`}
              </span>
            </div>
            {!isSameChain && !dstAddress && (
              <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
                Connect a wallet on <strong>{getChainName(dstChainKey) || dstChainKey}</strong> so we can identify your
                debt position there.{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-amber-700"
                  onClick={openWalletModal}
                >
                  Open wallet menu
                </button>
              </p>
            )}
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
                disabled={isBusy || !hasDebt || parsedMaxBalance === undefined}
              >
                Max
              </Button>
            </div>

            <div className="space-y-1">
              {hasDebt && parsedMaxDebt !== undefined && (
                <p className="text-xs text-muted-foreground">
                  Max debt: {formatDecimalForDisplay(parsedMaxDebt.toString(), 4)} {token.symbol}
                </p>
              )}
              {isBalanceLoading ? (
                <Skeleton className="h-4 w-40" />
              ) : (
                parsedMaxBalance !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    Wallet balance: {formatDecimalForDisplay(parsedMaxBalance.toString(), 4)}{' '}
                    {sourceToken.symbol || token.symbol}
                  </p>
                )
              )}
              {!hasDebt && parsedAmount !== undefined && parsedAmount > 0 && !isBusy && (
                <ErrorAlert text="No debt to repay" variant="compact" />
              )}
              {hasDebt && exceedsMaxDebt && !isBusy && parsedMaxDebt !== undefined && (
                <ErrorAlert
                  text={`Amount exceeds maximum debt: ${formatDecimalForDisplay(parsedMaxDebt.toString(), 4)} ${token.symbol}`}
                  variant="compact"
                />
              )}
              {hasDebt && !exceedsMaxDebt && insufficientBalance && !isBusy && parsedMaxBalance !== undefined && (
                <ErrorAlert
                  text={`Insufficient balance on ${getChainName(srcChainKey) || srcChainKey}: ${formatDecimalForDisplay(parsedMaxBalance.toString(), 4)} ${sourceToken.symbol || token.symbol}`}
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
            repaying with BTC.
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
            // Always show "Repaying..." when repay transaction is pending (prevents flickering)
            <Button className="w-full" disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Repaying...
            </Button>
          ) : isApproving ? (
            // Show "Approving..." when approval transaction is pending
            <Button className="w-full" disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Approving...
            </Button>
          ) : !hasDebt ? (
            <Button className="w-full" variant="default" disabled>
              No debt to repay
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
              onClick={handleRepay}
              disabled={!params || !sourceWalletProvider || !amount || btcNotReady}
            >
              Repay {token.symbol}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
