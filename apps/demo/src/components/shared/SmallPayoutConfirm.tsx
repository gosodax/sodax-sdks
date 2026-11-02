import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { getMpcPayoutWarning, type MpcPayoutWarning, type XToken } from '@sodax/dapp-kit';
import { formatUnits } from 'viem';
import { getChainName } from '@/constants';

type PendingAction = { amount: bigint; run: () => void };

/**
 * Asks before a payout small enough for the MPC relay's release fee to consume it. Wrap the action in
 * `guard`, and render {@link SmallPayoutConfirm} while `confirming`. Changing the amount drops the question.
 */
export function useSmallPayoutGuard(token: XToken | undefined, amount: bigint | undefined, amountDecimals?: number) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const warning = token && amount ? getMpcPayoutWarning(token, amount, amountDecimals) : undefined;
  const confirming = warning !== undefined && pending !== null && pending.amount === amount;

  const guard = (run: () => void): void => {
    if (warning && amount) setPending({ amount, run });
    else run();
  };
  const onCancel = (): void => setPending(null);
  const onContinue = (): void => {
    setPending(null);
    pending?.run();
  };

  return { warning, confirming, guard, onCancel, onContinue };
}

export function SmallPayoutConfirm({
  warning,
  chainKey,
  onContinue,
  onCancel,
}: {
  warning: MpcPayoutWarning;
  chainKey: XToken['chainKey'];
  onContinue: () => void;
  onCancel: () => void;
}) {
  const minimum = `${formatUnits(warning.minimum, warning.decimals)} ${warning.symbol}`;
  return (
    <div
      role="alertdialog"
      aria-label="Small payout warning"
      className="min-w-0 w-full space-y-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-200 dark:border-amber-900"
    >
      <p>
        Sending <strong>{minimum}</strong> or less to <strong>{getChainName(chainKey) || chainKey}</strong> is not
        advised. A variable relay fee comes out of this payout, and if the fee reaches the amount, nothing is delivered
        and your funds could be lost.
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" type="button" variant="cherrySoda" size="sm" onClick={onContinue}>
          Continue anyway
        </Button>
      </div>
    </div>
  );
}
