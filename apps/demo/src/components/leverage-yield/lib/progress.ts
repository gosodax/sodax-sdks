import type { StepStatus } from '../Stepper';
import type { FlowState, FlowStep } from '../hooks/useFlowState';
import type { IntentPhase } from '../hooks/useIntentStatus';

export type ProgressRow = 'approve' | 'sign' | 'deliver' | 'fill';

const ORDER: FlowStep[] = ['idle', 'preparing', 'approving', 'signing', 'processing', 'done'];

/**
 * The step to show. A flow that handed off at 'processing' (the API path) takes done/failed from the live intent
 * status; SDK flows report their own outcome.
 */
export function displayStep(state: FlowState, phase: IntentPhase): FlowStep {
  if (state.step !== 'processing' || !state.handedOff) return state.step;
  return phase === 'filled' ? 'done' : phase === 'failed' ? 'error' : 'processing';
}

export function isBusy(step: FlowStep): boolean {
  return step !== 'idle' && step !== 'done' && step !== 'error';
}

/** Status of each stepper row. `withApproval`: deposits show an approve row, withdraws don't. */
export function progressRows(
  state: FlowState,
  phase: IntentPhase,
  withApproval: boolean,
): Record<ProgressRow, StepStatus> {
  const step = displayStep(state, phase);
  const at = step === 'error' ? (state.failedStep ?? 'processing') : step;
  const reached = (target: FlowStep) => ORDER.indexOf(at) >= ORDER.indexOf(target);
  const signed = reached('processing');
  const filled = step === 'done' || phase === 'filled';
  const firstRowActive = at === 'approving' || at === 'preparing';

  const rows: Record<ProgressRow, StepStatus> = {
    approve: firstRowActive ? 'active' : reached('signing') ? (state.approveTxHash ? 'done' : 'skipped') : 'pending',
    sign: at === 'signing' || (!withApproval && firstRowActive) ? 'active' : signed ? 'done' : 'pending',
    deliver: !signed ? 'pending' : filled || phase === 'filling' ? 'done' : 'active',
    fill: filled ? 'done' : signed && phase === 'filling' ? 'active' : 'pending',
  };
  if (step === 'error') rows[errorRow(at, phase, withApproval)] = 'error';
  return rows;
}

function errorRow(failedAt: FlowStep, phase: IntentPhase, withApproval: boolean): ProgressRow {
  if (failedAt === 'preparing' || failedAt === 'approving') return withApproval ? 'approve' : 'sign';
  if (failedAt === 'signing') return 'sign';
  return phase === 'filling' ? 'fill' : 'deliver';
}
