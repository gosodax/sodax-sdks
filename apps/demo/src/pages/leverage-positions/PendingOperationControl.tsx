/**
 * Pending-operation banner with a cancel.
 *
 * A position allows one intent at a time, so while something is in flight every other control is
 * unusable — that state needs to be visible rather than expressed only as disabled buttons. Cancel
 * is the escape hatch when no solver fills: it drops the grant the hook was given, cancels the
 * intent, and returns anything the position is holding loose to the owner. A position carrying no
 * debt also withdraws its whole collateral balance back, which is what a leveraged open whose intent
 * never filled needs.
 *
 * Cancelling before the deadline is allowed and is the owner's call to make. After the deadline the
 * intent is cancellable by anyone, which resolves the intent without the position being told — so the
 * slot stays occupied until someone settles. Nothing notifies it; that is what `needsSettle` is for.
 *
 * Settle is also the second half of a close that exited into the debt token: the fill leaves the
 * surplus sitting in the position, and this sweep is what delivers it to the owner.
 */

import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useSodaxContext, type LeveragePositionPendingState, type SpokeChainKey } from '@sodax/dapp-kit';
import { useQuery } from '@tanstack/react-query';
import { erc20Abi } from 'viem';
import type { Address } from 'viem';
import { Check, CircleAlert, Loader2 } from 'lucide-react';
import { getReadableTxError } from '@/lib/utils';
import { useRunPositionOperation } from './useHubWalletRoute';
import { Notice } from './PositionSummary';

export function PendingOperationControl({
  chain,
  position,
  owner,
  slot,
  collateralToken,
  borrowToken,
}: {
  chain: SpokeChainKey;
  position: Address;
  owner: Address | undefined;
  slot: LeveragePositionPendingState;
  collateralToken: Address | undefined;
  borrowToken: Address | undefined;
}) {
  const { sodax } = useSodaxContext();
  const queryClient = useQueryClient();
  const { route } = useRunPositionOperation(chain);

  /**
   * Whether settling would move anything. A close that delivered its surplus leaves the position
   * empty, so the slot is resolved with nothing to recover — a state worth telling apart from one
   * holding a contribution, because only the second is urgent.
   *
   * `undefined` is a THIRD answer, not a zero: the query is disabled until both token addresses are
   * known, so reading `idle ?? 0n` claimed "nothing left to recover" on a position nobody had looked
   * at yet. It also only sees these two tokens, so it answers for the assets this position deals in,
   * not for everything an address could hold.
   */
  const { data: idle } = useQuery({
    queryKey: ['leverageYield', 'positionIdle', position, collateralToken, borrowToken],
    enabled: !!collateralToken && !!borrowToken,
    refetchInterval: 15_000,
    queryFn: async (): Promise<bigint> => {
      const balances = await Promise.all(
        [collateralToken, borrowToken].map(t =>
          sodax.hubProvider.publicClient.readContract({
            address: t as Address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [position],
          }),
        ),
      );
      return balances.reduce((a, b) => a + b, 0n);
    },
  });

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  /**
   * `settle()` rather than `cancel()`: the intent has already resolved, so there is nothing to
   * cancel — cancelling would revert IntentNotFound. This clears the stale slot, drops the grant and
   * sweeps any idle balance back to the owner. Permissionless, which is why it is offered even when
   * the viewer is not the owner.
   */
  const onSettle = useCallback(async () => {
    if (!owner) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = sodax.leverageYield.buildSettlePosition({ from: owner, position });
      const { dstChainTxHash } = await route([tx]);
      setStatus(
        `Cleared (${dstChainTxHash.slice(0, 10)}…). Anything the position held loose went to your hub wallet, not the address you signed with.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(false);
    }
  }, [owner, sodax, position, route, queryClient]);

  const onCancel = useCallback(async () => {
    if (!owner) return;
    setBusy(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = sodax.leverageYield.buildCancelPositionOperation({ from: owner, position });
      const { dstChainTxHash } = await route([tx]);
      setStatus(`Cancelled (${dstChainTxHash.slice(0, 10)}…)`);
      await queryClient.invalidateQueries({ queryKey: ['leverageYield'] });
    } catch (e) {
      setError(getReadableTxError(e));
    } finally {
      setBusy(false);
    }
  }, [owner, sodax, position, route, queryClient]);

  /**
   * Where the slot is in its life. Each state admits exactly one action, so the UI offers exactly one
   * button — the old two-button row needed a paragraph explaining which of them applied, which is a
   * sign the paragraph was doing the work the layout should have.
   */
  const stage: 'filling' | 'checking' | 'recoverable' | 'settled' = slot.isLive
    ? 'filling'
    : idle === undefined
      ? 'checking'
      : idle > 0n
        ? 'recoverable'
        : 'settled';
  const activeStep = stage === 'filling' ? 1 : 2;
  const steps = ['Posted', 'Filling', stage === 'recoverable' ? 'Settle' : 'Done'];

  return (
    <div className="space-y-2 border-t pt-2">
      {/* Three dots beat a sentence: the position is one of three places and this says which. */}
      <div className="flex items-center gap-1.5">
        {steps.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && <div className={`h-px flex-1 ${i <= activeStep ? 'bg-cherry-soda' : 'bg-border'}`} />}
            <span
              className={`flex items-center gap-1 whitespace-nowrap text-[10px] ${
                i <= activeStep ? '' : 'text-muted-foreground'
              }`}
            >
              {i < activeStep ? (
                <Check className="h-3 w-3 text-cherry-soda" />
              ) : i === activeStep ? (
                stage === 'filling' ? (
                  <Loader2 className="h-3 w-3 animate-spin text-cherry-soda" />
                ) : stage === 'recoverable' ? (
                  <CircleAlert className="h-3 w-3 text-yellow-dark" />
                ) : (
                  <Check className="h-3 w-3 text-cherry-soda" />
                )
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-border" />
              )}
              {label}
            </span>
          </React.Fragment>
        ))}
      </div>

      {stage === 'filling' && (
        <>
          <div className="text-[10px] text-muted-foreground">
            This position is locked while the solver fills. If it expires, cancel to recover funds.
          </div>
          <Button
            className="h-auto min-h-9 w-full whitespace-normal text-center"
            size="sm"
            variant="outline"
            disabled={busy || !owner}
            onClick={onCancel}
          >
            {busy ? 'Working…' : 'Cancel and recover funds'}
          </Button>
        </>
      )}

      {stage === 'recoverable' && (
        <>
          <Notice tone="warn" icon={CircleAlert}>
            The fill resolved, but funds are still in the position. Settle returns them to your hub wallet{' '}
            <span className="font-mono">{owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : ''}</span> — `settle()`
            takes no destination, so it can only pay the position's owner.
          </Notice>
          <Button
            className="h-auto min-h-9 w-full whitespace-normal text-center"
            size="sm"
            disabled={busy || !owner}
            onClick={onSettle}
          >
            {busy ? 'Working…' : 'Settle and recover funds'}
          </Button>
        </>
      )}

      {(stage === 'checking' || stage === 'settled') && (
        <>
          {/* "Tidy up" named the housekeeping, not the effect, so it could not answer the only
              question it raised: what happens if I leave it. Both sentences now say that outright. */}
          <Notice>
            {stage === 'checking'
              ? 'Finished. Still checking whether anything is left in the position.'
              : 'Finished, and the position is holding none of its own tokens.'}{' '}
            The operation stays on record until it is cleared, which keeps the position's grant open. Adjusting and
            closing still work meanwhile.
          </Notice>
          <Button
            className="h-auto min-h-9 w-full whitespace-normal text-center"
            size="sm"
            variant="outline"
            disabled={busy || !owner}
            onClick={onSettle}
          >
            {busy ? 'Working…' : 'Clear the finished operation'}
          </Button>
        </>
      )}

      {status && <div className="text-xs text-cherry-soda break-all">{status}</div>}
      {error && <div className="text-xs text-negative break-all">{error}</div>}
    </div>
  );
}
