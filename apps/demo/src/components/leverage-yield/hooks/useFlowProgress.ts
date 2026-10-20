import type { SpokeChainKey } from '@sodax/dapp-kit';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { displayStep, isBusy, progressRows } from '../lib/progress';
import type { FlowState } from './useFlowState';
import { useIntentStatus } from './useIntentStatus';

/** After this long in 'processing' the dialog becomes closable (the tx may still complete). */
const PROCESSING_TIMEOUT_MS = 5 * 60_000;

/**
 * Everything a deposit/withdraw dialog shows while a flow runs: the step, stepper rows and live intent status.
 * Refreshes share and wallet balances once the flow completes, so "Your vaults" updates right away.
 */
export function useFlowProgress(state: FlowState, srcChainKey: SpokeChainKey, withApproval: boolean) {
  const status = useIntentStatus(srcChainKey, state.srcTxHash, !!state.handedOff);
  const step = displayStep(state, status.phase);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (step !== 'done') return;
    void queryClient.invalidateQueries({ queryKey: ['leverageYield', 'shareBalance'] });
    void queryClient.invalidateQueries({ queryKey: ['shared', 'balances'] });
  }, [step, queryClient]);

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    if (step !== 'processing') return;
    const timer = setTimeout(() => setTimedOut(true), PROCESSING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [step]);

  return {
    step,
    busy: isBusy(step) && !timedOut,
    timedOut,
    rows: progressRows(state, status.phase, withApproval),
    error: state.error ?? status.message,
    fillTxHash: status.fillTxHash,
  };
}
