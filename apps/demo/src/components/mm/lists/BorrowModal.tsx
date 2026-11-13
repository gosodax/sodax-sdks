import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PayoutMinimumNotice } from '@/components/shared/PayoutMinimumNotice';
import { DeliverableLiquidityNotice } from '@/components/shared/DeliverableLiquidityNotice';
import { useUnmetDeliverableLiquidity } from '@/hooks/useDeliverableLiquidity';
import { TokenIcon } from '@/components/shared/TokenIcon';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChainSelector } from '@/components/shared/ChainSelector';
import { useEvmSwitchChain, useWalletProvider, useXAccount } from '@sodax/wallet-sdk-react';
import { parseUnits, formatUnits } from 'viem';
import {
  type FormatUserSummaryResponse,
  type MoneyMarketBorrowParams,
  type SpokeChainKey,
  type XToken,
  useBorrow,
  useReservesUsdFormat,
  useAToken,
  useUserReservesData,
  useSodaxContext,
  useNearStorageGate,
  getUnmetMpcPayoutMinimum,
  calculateFeeAmount,
} from '@sodax/dapp-kit';
import { buildMmDeliveryParams } from '@/lib/mmBtc';
import { useBtcTradingBalance } from '@/hooks/useBtcTradingBalance';
import { useAppStore } from '@/zustand/useAppStore';
import {
  getChainsWithThisToken,
  getMmErrorText,
  getTokenOnChain,
  getNativeTokenSymbol,
  formatDecimalForDisplay,
  getSafeMaxAmountForInput,
  truncateToDecimals,
  formatMutationFailureMessage,
} from '@/lib/utils';
import { logger } from '@/lib/logger';
import { useReserveMetrics } from '@/hooks/useReserveMetrics';
import { MAX_BORROW_SAFETY_MARGIN, ZERO_ADDRESS, AMOUNT_DISPLAY_DECIMALS } from '../constants';
import { isUserReserveDataArray, isValidEvmAddress } from '../typeGuards';
import { settledTx } from '@/lib/extractTxHash';
import { ErrorAlert } from '../ErrorAlert';
import { getChainName } from '@/constants';
import { ActionSuccessContent, type ActionSuccessData } from './ActionSuccessContent';
import { Loader2 } from 'lucide-react';

interface BorrowModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: XToken;
  inlineSuccess?: boolean;
  onSuccess?: (data: {
    amount: string;
    token: XToken;
    sourceChainId: SpokeChainKey;
    destinationChainId: SpokeChainKey;
    txHash?: string;
  }) => void;
  maxBorrow: string;
  priceUSD: number;
  /** User summary from the market chain (where collateral is). Used to recalculate max borrow. */
  userSummary?: FormatUserSummaryResponse;
}

export function BorrowModal({
  open,
  onOpenChange,
  token,
  onSuccess,
  maxBorrow: initialMaxBorrow,
  priceUSD: initialPriceUSD,
  inlineSuccess,
  userSummary,
}: BorrowModalProps) {
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [successData, setSuccessData] = useState<ActionSuccessData | null>(null);
  const [nearStorageError, setNearStorageError] = useState<string | null>(null);
  const { selectedChainId, openWalletModal, isWalletModalOpen } = useAppStore();
  const { sodax } = useSodaxContext();

  const srcChainKey = selectedChainId;
  const [dstChainKey, setDstChainKey] = useState<SpokeChainKey>(token.chainKey);

  const supportedDestinationChains = getChainsWithThisToken(sodax, token);
  const destinationToken = getTokenOnChain(sodax, token.symbol, dstChainKey);

  const sourceWalletProvider = useWalletProvider({ xChainId: srcChainKey });
  const destWalletProvider = useWalletProvider({ xChainId: dstChainKey });
  const { address: srcAddress } = useXAccount({ xChainId: srcChainKey });
  const { address: dstAddress } = useXAccount({ xChainId: dstChainKey });

  // BTC delivery goes to the Bound Exchange trading wallet; needs a signed-in session (balance not required).
  const { isBitcoin: isBtcDelivery, tradingAddress: deliveryTradingAddress } = useBtcTradingBalance({
    chainId: dstChainKey,
  });
  const btcDeliveryNotReady = isBtcDelivery && !!dstAddress && !deliveryTradingAddress;

  const isSameChain = srcChainKey === dstChainKey;

  const nearStorage = useNearStorageGate({
    dstChainKey,
    token: destinationToken?.address,
    accountId: dstAddress,
    walletProvider: destWalletProvider,
  });

  const { data: formattedReserves } = useReservesUsdFormat();
  const { data: destinationUserReserves } = useUserReservesData({
    params: { spokeChainKey: dstChainKey, userAddress: dstAddress },
  });

  const tokenForMetrics = destinationToken ?? token;
  const destinationUserReservesArray = destinationUserReserves?.[0] || [];
  if (!isUserReserveDataArray(destinationUserReservesArray)) {
    throw new Error('Invalid type of variable destinationUserReserves: expected UserReserveData[]');
  }

  const destinationMetrics = useReserveMetrics({
    token: tokenForMetrics,
    formattedReserves: formattedReserves || [],
    userReserves: destinationUserReservesArray,
  });

  const rawATokenAddress = destinationMetrics.formattedReserve?.aTokenAddress;
  const aTokenAddress =
    rawATokenAddress && rawATokenAddress !== ZERO_ADDRESS && isValidEvmAddress(rawATokenAddress)
      ? rawATokenAddress
      : undefined;

  const { data: aToken } = useAToken({ params: { aToken: aTokenAddress } });

  const maxBorrow = useMemo(() => {
    if (!userSummary) return initialMaxBorrow;

    let availableBorrowsUSD = Number(userSummary.availableBorrowsUSD);

    // Fallback: SDK can return 0 due to rounding even when collateral exists; recompute from LTV.
    if (availableBorrowsUSD === 0 && Number(userSummary.totalCollateralUSD) > 0) {
      const totalCollateralUSD = Number(userSummary.totalCollateralUSD);
      const totalBorrowsUSD = Number(userSummary.totalBorrowsUSD);
      const currentLoanToValue = Number(userSummary.currentLoanToValue);
      availableBorrowsUSD = Math.max(0, totalCollateralUSD * currentLoanToValue - totalBorrowsUSD);
    }

    if (availableBorrowsUSD <= 0) return '0';

    const destinationPriceUSD = destinationMetrics.formattedReserve
      ? Number(destinationMetrics.formattedReserve.priceInUSD)
      : 0;
    const finalPriceUSD = destinationPriceUSD > 0 ? destinationPriceUSD : initialPriceUSD;

    if (finalPriceUSD <= 0) return initialMaxBorrow;

    const userLimitTokens = availableBorrowsUSD / finalPriceUSD;
    let calculatedMaxBorrow = userLimitTokens;

    if (destinationMetrics.formattedReserve && aToken) {
      const availableLiquidityNum = Number.parseFloat(
        formatUnits(BigInt(destinationMetrics.formattedReserve.availableLiquidity), aToken.decimals),
      );
      const borrowCap = destinationMetrics.formattedReserve.borrowCap;
      const poolLimitTokens =
        borrowCap === '0'
          ? availableLiquidityNum
          : Math.min(
              availableLiquidityNum,
              Number.parseFloat(borrowCap) - Number.parseFloat(destinationMetrics.formattedReserve.totalVariableDebt),
            );

      if (poolLimitTokens > 0) {
        calculatedMaxBorrow = Math.min(userLimitTokens, poolLimitTokens);
      }
    }

    return truncateToDecimals(calculatedMaxBorrow * MAX_BORROW_SAFETY_MARGIN, AMOUNT_DISPLAY_DECIMALS);
  }, [userSummary, destinationMetrics.formattedReserve, aToken, initialMaxBorrow, initialPriceUSD]);

  const isMaxBorrowEffectivelyZero = useMemo(() => {
    if (!maxBorrow || maxBorrow === '0') return true;
    const maxBorrowNum = Number.parseFloat(maxBorrow);
    return maxBorrowNum <= 0 || Number.isNaN(maxBorrowNum);
  }, [maxBorrow]);

  const parsedAmount: number | undefined = useMemo(() => {
    const raw = Number.parseFloat(amount.replace(',', '.'));
    if (Number.isNaN(raw) || raw <= 0) return undefined;
    return raw;
  }, [amount]);

  const parsedMaxAmount: number | undefined = useMemo(() => {
    if (!maxBorrow) return undefined;
    const num = Number.parseFloat(maxBorrow);
    if (!Number.isFinite(num) || num <= 0) return undefined;
    return num;
  }, [maxBorrow]);

  const exceedsMaxBorrow =
    parsedAmount !== undefined && parsedMaxAmount !== undefined && parsedAmount > parsedMaxAmount;

  const { mutateAsync: borrow, isPending, error, reset: resetBorrowError } = useBorrow();

  const params: MoneyMarketBorrowParams | undefined = useMemo(() => {
    if (!parsedAmount || exceedsMaxBorrow || !destinationToken || !srcAddress) return undefined;

    const crossChainParams = buildMmDeliveryParams({
      dstChainKey,
      dstAddress,
      isSameChain,
      btcTradingAddress: deliveryTradingAddress,
    });
    if (crossChainParams === null) return undefined; // BTC delivery requires a connected destination wallet

    return {
      srcChainKey,
      srcAddress,
      token: destinationToken.address,
      amount: parseUnits(amount, destinationToken.decimals),
      action: 'borrow',
      ...crossChainParams,
    };
  }, [
    amount,
    parsedAmount,
    exceedsMaxBorrow,
    destinationToken,
    srcChainKey,
    dstChainKey,
    dstAddress,
    srcAddress,
    isSameChain,
    deliveryTradingAddress,
  ]);

  const unmetPayoutMinimum =
    destinationToken && params?.amount
      ? getUnmetMpcPayoutMinimum({ token: destinationToken, amount: params.amount })
      : undefined;
  // The vault pays out the borrow net of the partner fee.
  const deliverable = useUnmetDeliverableLiquidity({
    token: destinationToken,
    amount:
      params?.amount !== undefined
        ? params.amount - calculateFeeAmount(params.amount, sodax.moneyMarket.partnerFee)
        : undefined,
  });

  const { isWrongChain, handleSwitchChain } = useEvmSwitchChain({ xChainId: srcChainKey });

  const handleBorrow = async (): Promise<void> => {
    if (!sourceWalletProvider || !params) return;

    try {
      const normalizedAmount = amount.replace(',', '.');
      const result = await borrow({ params, walletProvider: sourceWalletProvider });

      const nextSuccessData: ActionSuccessData = {
        amount: normalizedAmount,
        token,
        sourceChainId: srcChainKey,
        destinationChainId: dstChainKey,
        ...settledTx(result, { srcChainKey, dstChainKey }),
      };

      if (inlineSuccess) {
        setSuccessData(nextSuccessData);
        setStep('success');
      } else {
        onSuccess?.(nextSuccessData);
        onOpenChange(false);
      }
    } catch (err) {
      logger.error('Borrow failed', err);
    }
  };

  const handleRegisterNearStorage = async (): Promise<void> => {
    const result = await nearStorage.registerStorage();
    if (result && !result.ok) {
      setNearStorageError(formatMutationFailureMessage(result.error, 'Storage registration failed'));
      return;
    }
    setNearStorageError(null);
  };

  const handleMaxClick = (): void => {
    if (isMaxBorrowEffectivelyZero) return;
    setAmount(getSafeMaxAmountForInput(maxBorrow));
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
      setNearStorageError(null);
      setDstChainKey(token.chainKey);
      resetBorrowError?.();
    }
  };

  if (inlineSuccess && step === 'success' && successData) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChangeInternal} modal={!isWalletModalOpen}>
        <DialogContent className="sm:max-w-sm border-cherry-grey/20">
          <ActionSuccessContent action="borrow" data={successData} onClose={() => onOpenChange(false)} />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChangeInternal} modal={!isWalletModalOpen}>
      <DialogContent className="min-w-0 max-w-[calc(100vw-2rem)] overflow-x-hidden sm:max-w-md border-cherry-grey/20">
        <DialogHeader>
          <DialogTitle className="text-center text-cherry-dark">Borrow {token.symbol}</DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Label>Deliver funds to</Label>
            <ChainSelector
              selectedChainId={dstChainKey}
              selectChainId={setDstChainKey}
              allowedChains={supportedDestinationChains}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted text-cherry-dark">
                {isSameChain ? 'Same-chain' : 'Cross-chain'}
              </span>
              <span className="text-xs text-muted-foreground">
                {isSameChain
                  ? `Borrow ${token.symbol} on ${getChainName(srcChainKey) || srcChainKey}`
                  : `Borrow ${token.symbol} against your collateral on ${getChainName(srcChainKey) || srcChainKey} to ${
                      getChainName(dstChainKey) || dstChainKey
                    }`}
              </span>
            </div>
            {!isSameChain && !dstAddress && (
              <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
                Connect a wallet on <strong>{getChainName(dstChainKey) || dstChainKey}</strong> to receive the borrowed
                funds there.{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-amber-700"
                  onClick={openWalletModal}
                >
                  Open wallet menu
                </button>
              </p>
            )}
            {btcDeliveryNotReady && (
              <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
                Sign in to the <strong>Bitcoin Trading Wallet</strong> section on the Money Market page to receive the
                borrowed BTC.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <div className="flex items-center gap-2">
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={isPending}
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
                disabled={isPending || isMaxBorrowEffectivelyZero}
              >
                Max
              </Button>
            </div>

            <div className="space-y-1">
              {!isMaxBorrowEffectivelyZero && (
                <p className="text-xs text-muted-foreground">
                  Max borrow: {formatDecimalForDisplay(maxBorrow, 4)} {token.symbol}
                </p>
              )}
              {parsedAmount !== undefined && isMaxBorrowEffectivelyZero && !isPending && (
                <ErrorAlert
                  text="Insufficient collateral to borrow this asset. Supply more collateral to borrow."
                  variant="compact"
                />
              )}
              {exceedsMaxBorrow && !isPending && parsedMaxAmount !== undefined && (
                <ErrorAlert
                  text={`Amount exceeds maximum borrowable: ${formatDecimalForDisplay(maxBorrow, 4)} ${token.symbol}`}
                  variant="compact"
                />
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="min-w-0 w-full">
            <ErrorAlert text={getMmErrorText(error)} />
          </div>
        )}

        {nearStorage.needsRegistration && (
          <div className="min-w-0 w-full">
            <ErrorAlert text="Recipient is not storage-registered for this token on NEAR. Register storage to receive the borrowed funds." />
          </div>
        )}
        {nearStorageError && (
          <div className="min-w-0 w-full">
            <ErrorAlert text={nearStorageError} />
          </div>
        )}

        {!isWrongChain && !!srcAddress && !!parsedAmount && (
          <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-800">
            Make sure you have enough <strong>{getNativeTokenSymbol(srcChainKey)}</strong> on{' '}
            <strong>{getChainName(srcChainKey) || srcChainKey}</strong> to cover gas fees for this transaction.
          </p>
        )}

        {unmetPayoutMinimum && <PayoutMinimumNotice unmet={unmetPayoutMinimum} chainKey={dstChainKey} />}
        {deliverable.unmet !== undefined && destinationToken && (
          <DeliverableLiquidityNotice available={deliverable.unmet} token={destinationToken} />
        )}

        <DialogFooter className="w-full min-w-0 flex-col gap-2 sm:justify-start">
          {nearStorage.isNear && (nearStorage.isChecking || nearStorage.needsRegistration) && (
            <Button
              className="w-full"
              variant="cherry"
              onClick={handleRegisterNearStorage}
              disabled={nearStorage.isChecking || nearStorage.isRegistering}
            >
              {nearStorage.isChecking ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking storage…
                </>
              ) : nearStorage.isRegistering ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Registering…
                </>
              ) : (
                'Register Storage on NEAR'
              )}
            </Button>
          )}
          {isWrongChain ? (
            <Button className="w-full" variant="cherry" onClick={handleSwitchChain} disabled={isPending}>
              Switch Chain
            </Button>
          ) : isPending ? (
            <Button className="w-full" disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Borrowing...
            </Button>
          ) : (
            <Button
              className="w-full"
              type="button"
              variant="default"
              onClick={() => void handleBorrow()}
              disabled={
                unmetPayoutMinimum !== undefined ||
                deliverable.unmet !== undefined ||
                deliverable.pending ||
                !params ||
                !sourceWalletProvider ||
                nearStorage.blocksAction
              }
            >
              Borrow {token.symbol}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
