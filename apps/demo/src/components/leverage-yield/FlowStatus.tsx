import React, { type ReactNode } from 'react';
import { CheckCircle2Icon } from 'lucide-react';
import { Callout } from './Callout';
import { PillButton } from './PillButton';
import type { useFlowProgress } from './hooks/useFlowProgress';

/**
 * What a running or finished deposit/withdraw shows under its summary: a status line, the outcome and the buttons.
 * "Try again" only appears when nothing was sent, so a failed flow is never blindly repeated.
 */
export function FlowStatus({
  progress,
  sent,
  noun,
  success,
  onRetry,
  onBack,
  onClose,
}: {
  progress: ReturnType<typeof useFlowProgress>;
  /** A source-chain transaction was sent, or may have been (`'maybe'`: signed, hash unknown). */
  sent: boolean | 'maybe';
  noun: 'Deposit' | 'Withdrawal';
  /** Title and body of the success callout. */
  success: { title: string; body: ReactNode };
  onRetry: () => void;
  /** Back to the form after a failure (instead of Close). */
  onBack?: () => void;
  onClose: () => void;
}) {
  const { step, timedOut } = progress;
  const retry = step === 'error' && !sent;

  return (
    <>
      {(step === 'preparing' || step === 'approving' || step === 'signing') && (
        <p className="text-sm text-muted-foreground">Check your wallet to continue.</p>
      )}
      {step === 'processing' &&
        (timedOut ? (
          <Callout>
            Still processing after 5 minutes. It may yet complete: check the explorer link. You can close this window.
          </Callout>
        ) : (
          <p className="text-sm text-muted-foreground">Keep this window open. This usually takes under two minutes.</p>
        ))}
      {step === 'error' && (
        <Callout variant="destructive">
          <p className="font-semibold">{noun} not completed</p>
          <p className="mt-1 break-words">{progress.error}</p>
          {sent && (
            <p className="mt-1">
              {sent === 'maybe'
                ? "Your transaction may have been sent. Check your wallet's activity before retrying."
                : 'Your transaction was sent. Check its status before retrying.'}
            </p>
          )}
        </Callout>
      )}
      {step === 'done' && (
        <Callout variant="success">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2Icon className="size-4" /> {success.title}
          </p>
          <p className="mt-1 text-foreground">{success.body}</p>
        </Callout>
      )}
      {(step === 'done' || step === 'error' || timedOut) && (
        <div className="flex gap-2">
          {retry && (
            <PillButton variant="outline" onClick={onBack ?? onClose}>
              {onBack ? 'Back' : 'Close'}
            </PillButton>
          )}
          {retry ? (
            <PillButton className="flex-1" onClick={onRetry}>
              Try again
            </PillButton>
          ) : (
            <PillButton className="flex-1" variant={step === 'done' ? 'default' : 'outline'} onClick={onClose}>
              {step === 'done' ? 'Done' : 'Close'}
            </PillButton>
          )}
        </div>
      )}
    </>
  );
}
