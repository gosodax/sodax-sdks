import React, { useEffect, useState } from 'react';
import { isNativeToken, type LeverageYieldVault, type SpokeChainKey, type XToken } from '@sodax/dapp-kit';
import { Callout } from './Callout';
import { FlowStatus } from './FlowStatus';
import { useChainWallet } from './hooks/useChainWallet';
import { useFlowProgress } from './hooks/useFlowProgress';
import { useDepositFlow } from './hooks/useFlows';
import { useDepositQuote } from './hooks/useQuotes';
import type { VaultStats } from './hooks/useVaultReads';
import { chainName } from './lib/chains';
import { formatTokenAmount } from './lib/format';
import { depositSteps } from './lib/steps';
import type { UsdPrices } from './lib/usd';
import { formatShares } from './lib/vaults';
import { PillButton } from './PillButton';
import { QuoteDetails } from './QuoteDetails';
import { QuoteError } from './QuoteError';
import { RiskNotice } from './RiskNotice';
import { SidePanel } from './SidePanel';

/**
 * What the user is reviewing: inputs frozen when they clicked Review. The review quotes these exact inputs live and
 * captures the minimum when they click Confirm.
 */
export type DepositReviewInput = {
  vault: LeverageYieldVault;
  token: XToken;
  chainKey: SpokeChainKey;
  inputAmount: bigint;
};

/** Review → confirm → progress for one deposit, inside the vault dialog. */
export function DepositReview({
  review,
  stats,
  prices,
  onBack,
  onBusyChange,
  onClose,
}: {
  review: DepositReviewInput;
  stats: VaultStats;
  prices: UsdPrices;
  onBack: () => void;
  /** Tells the dialog to block closing and tab switches while a transaction is in flight. */
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const { vault, token, chainKey, inputAmount } = review;
  const { address, walletProvider, isWrongChain, switchChain } = useChainWallet(chainKey);
  const [confirmed, setConfirmed] = useState<{ shares: bigint; minShares: bigint }>();
  const { state, deposit } = useDepositFlow();
  const native = isNativeToken(chainKey, token);
  const progress = useFlowProgress(state, chainKey, !native);
  const { step } = progress;
  // Live quote for the frozen inputs while the user can (re)confirm; it stops once the flow starts.
  const live = step === 'idle' || step === 'error';
  const quote = useDepositQuote({ vault, srcChainKey: chainKey, token, inputAmount: live ? inputAmount : undefined });

  useEffect(() => {
    onBusyChange(progress.busy);
    return () => onBusyChange(false);
  }, [progress.busy, onBusyChange]);

  const confirm = () => {
    const minShares = quote.minAmountOut;
    if (!address || !walletProvider || quote.amountOut === undefined || minShares === undefined) return;
    if (quote.isLoading || quote.error) return;
    setConfirmed({ shares: quote.amountOut, minShares });
    void deposit({ vault, srcChainKey: chainKey, srcAddress: address, token, inputAmount, minShares, walletProvider });
  };

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-lg bg-muted p-4">
          <p className="mb-3 font-semibold">
            {step === 'idle' ? 'Review deposit' : step === 'done' ? 'Deposit complete' : 'Your deposit'}
          </p>
          {live && quote.error ? (
            <QuoteError message={quote.error} onRetry={quote.refetch} />
          ) : (
            <QuoteDetails
              vault={vault}
              stats={stats}
              prices={prices}
              shares={live ? quote.amountOut : confirmed?.shares}
              minShares={live ? quote.minAmountOut : confirmed?.minShares}
              review={review}
            />
          )}
        </div>

        {step === 'idle' && (
          <>
            <RiskNotice />
            <Callout>
              You will sign {native ? 'one transaction' : 'up to two transactions'} on {chainName(chainKey)}. After
              that, solvers fill the deposit, usually within a minute or two. Shares go to your SODAX hub wallet on
              Sonic.
            </Callout>
            <div className="flex gap-2">
              <PillButton variant="outline" size="lg" onClick={onBack}>
                Back
              </PillButton>
              {isWrongChain ? (
                <PillButton size="lg" className="flex-1" onClick={switchChain}>
                  Switch to {chainName(chainKey)}
                </PillButton>
              ) : (
                <PillButton
                  size="lg"
                  className="flex-1"
                  disabled={!walletProvider || quote.minAmountOut === undefined || quote.isLoading || !!quote.error}
                  onClick={confirm}
                >
                  Confirm deposit
                </PillButton>
              )}
            </div>
          </>
        )}

        <FlowStatus
          progress={progress}
          sent={state.srcTxHash ? true : state.maybeSent ? 'maybe' : false}
          noun="Deposit"
          success={{
            title: `Deposited ${formatTokenAmount(inputAmount, token.decimals)} ${token.symbol}`,
            body: `≈ ${formatShares(confirmed?.shares)} are now in your SODAX hub wallet. They show under Your vaults.`,
          }}
          onRetry={confirm}
          onBack={onBack}
          onClose={onClose}
        />
      </div>

      <SidePanel
        vault={vault}
        stats={stats}
        prices={prices}
        steps={depositSteps({ vault, token, chainKey, progress, state })}
      />
    </div>
  );
}
