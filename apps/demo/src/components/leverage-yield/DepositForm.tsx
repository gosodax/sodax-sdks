import React, { useMemo, useState } from 'react';
import { ChainKeys, type LeverageYieldVault, type SpokeChainKey } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChainSelect } from './ChainSelect';
import { DepositReview, type DepositReviewInput } from './DepositReview';
import { useChainWallet } from './hooks/useChainWallet';
import { useDepositQuote } from './hooks/useQuotes';
import { useSourceChains } from './hooks/useSourceChains';
import { useTokenBalance, useTokenChoice } from './hooks/useTokenChoice';
import { useTransport } from './transport';
import type { VaultStats } from './hooks/useVaultReads';
import { chainName } from './lib/chains';
import { formatTokenAmount, parseTokenAmount } from './lib/format';
import { depositSteps } from './lib/steps';
import { formatUsd, priceFor, toUsd, type UsdPrices } from './lib/usd';
import { SHARE_DECIMALS, shareValue } from './lib/vaults';
import { PillButton } from './PillButton';
import { ProjectedInterest } from './ProjectedInterest';
import { QuoteDetails } from './QuoteDetails';
import { QuoteError } from './QuoteError';
import { SidePanel } from './SidePanel';
import { TokenSelect } from './TokenSelect';

const DEFAULT_SOURCE_CHAIN: SpokeChainKey = ChainKeys.BASE_MAINNET;

/** Deposit tab: pay with a token from any source chain; "Review deposit" opens the review in place. */
export function DepositForm({
  vault,
  stats,
  prices,
  onBusyChange,
  onClose,
}: {
  vault: LeverageYieldVault;
  stats: VaultStats;
  prices: UsdPrices;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}) {
  const sourceChains = useSourceChains();
  const { canSign } = useTransport();
  const chains = useMemo(() => sourceChains.filter(canSign), [sourceChains, canSign]);
  const [chainKey, setChainKey] = useState<SpokeChainKey>(
    chains.includes(DEFAULT_SOURCE_CHAIN) ? DEFAULT_SOURCE_CHAIN : (chains[0] ?? DEFAULT_SOURCE_CHAIN),
  );
  const wallet = useChainWallet(chainKey);
  const { tokens, token, pickToken } = useTokenChoice(chainKey);

  const [amountText, setAmountText] = useState('');
  const inputAmount = token ? parseTokenAmount(amountText, token.decimals) : undefined;
  const { balance, isLoading: balanceLoading } = useTokenBalance(chainKey, token, wallet.address);

  // Inputs the user is reviewing. While the review is open it quotes them itself, so the form stops quoting.
  const [review, setReview] = useState<DepositReviewInput | null>(null);
  const quote = useDepositQuote({ vault, srcChainKey: chainKey, token, inputAmount: review ? undefined : inputAmount });

  const action = ((): { label: string; onClick?: () => void; disabled?: boolean } => {
    if (!wallet.isConnected) return { label: 'Connect wallet', onClick: wallet.connect };
    if (wallet.isWrongChain) return { label: `Switch to ${chainName(chainKey)}`, onClick: wallet.switchChain };
    if (!amountText) return { label: 'Enter an amount', disabled: true };
    if (!inputAmount) return { label: 'Enter a valid amount', disabled: true };
    if (balance !== undefined && inputAmount > balance) {
      return { label: `Insufficient ${token?.symbol}`, disabled: true };
    }
    if (quote.isLoading) return { label: 'Getting quote…', disabled: true };
    if (!token || quote.error || quote.amountOut === undefined || quote.minAmountOut === undefined) {
      return { label: 'No quote', disabled: true };
    }
    const reviewed = { vault, token, chainKey, inputAmount };
    return { label: 'Review deposit', onClick: () => setReview(reviewed) };
  })();

  if (!token) return null;
  if (review) {
    return (
      <DepositReview
        review={review}
        stats={stats}
        prices={prices}
        onBack={() => setReview(null)}
        onBusyChange={onBusyChange}
        onClose={onClose}
      />
    );
  }

  const shares = inputAmount ? quote.amountOut : undefined;
  const amountUsd = formatUsd(toUsd(inputAmount, token.decimals, priceFor(prices, token.vault)));

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="rounded-lg bg-muted p-4 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring">
          <div className="flex items-center justify-between gap-2 text-sm">
            <label htmlFor="deposit-amount" className="shrink-0 font-medium">
              You deposit
            </label>
            {wallet.isConnected && (
              <span className="text-right text-muted-foreground">
                Balance:{' '}
                {balanceLoading ? (
                  <Skeleton className="inline-block h-3 w-12 bg-card align-middle" />
                ) : (
                  `${formatTokenAmount(balance, token.decimals)} ${token.symbol}`
                )}
                {balance !== undefined && balance > 0n && (
                  <button
                    type="button"
                    className="ml-2 font-semibold text-primary hover:underline"
                    onClick={() => setAmountText(formatUnits(balance, token.decimals))}
                  >
                    Max
                  </button>
                )}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <TokenSelect tokens={tokens} value={token.address} onChange={pickToken} />
            <Input
              id="deposit-amount"
              inputMode="decimal"
              placeholder="0"
              value={amountText}
              onChange={event => setAmountText(event.target.value)}
              className="h-12 min-w-0 flex-1 border-0 bg-transparent px-0 text-right text-3xl font-semibold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 md:text-3xl"
            />
          </div>
          <div className="mt-2 flex min-h-8 items-center justify-between gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              on
              <ChainSelect value={chainKey} onChange={setChainKey} chains={chains} label="From network" />
            </span>
            <span>{amountUsd}</span>
          </div>
        </div>

        <div className="rounded-lg bg-muted p-4">
          <p className="text-sm font-medium">You get</p>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            {inputAmount && quote.isLoading ? (
              <Skeleton className="h-9 w-28 bg-card" />
            ) : (
              <span className={cn('min-w-0 truncate text-3xl font-semibold', !shares && 'text-subtle-foreground')}>
                {shares !== undefined ? `≈ ${formatTokenAmount(shares, SHARE_DECIMALS)}` : '0'}
              </span>
            )}
            <span className="shrink-0 text-sm text-muted-foreground">vault shares</span>
          </div>
          {!!inputAmount && quote.error && (
            <div className="mt-3">
              <QuoteError message={quote.error} onRetry={quote.refetch} />
            </div>
          )}
          <div className="mt-3 border-t pt-3">
            <QuoteDetails
              vault={vault}
              stats={stats}
              prices={prices}
              shares={shares}
              minShares={inputAmount ? quote.minAmountOut : undefined}
            />
          </div>
        </div>

        <ProjectedInterest
          vault={vault}
          assets={shareValue(shares, stats.sharePrice.data)}
          aprRay={stats.apr.data?.effectiveNetAprRay}
          prices={prices}
        />

        <PillButton size="lg" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </PillButton>
        <p className="text-center text-xs text-muted-foreground">
          Withdraw later from the same network you deposit from.
        </p>
      </div>

      <SidePanel vault={vault} stats={stats} prices={prices} steps={depositSteps({ vault, token, chainKey })} />
    </div>
  );
}
