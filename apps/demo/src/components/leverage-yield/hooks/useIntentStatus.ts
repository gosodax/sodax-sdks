import {
  type DetailedLeverageYieldStatus,
  SolverIntentStatusCode,
  type SpokeChainKey,
  useLeverageYieldDetailedStatus,
} from '@sodax/dapp-kit';
import { useTransport } from '../transport';

export type IntentPhase = 'relaying' | 'filling' | 'filled' | 'failed' | 'unknown';

const STATUS_REFETCH_MS = 10_000;

const BACKEND_PHASE: Record<string, IntentPhase> = {
  pending: 'relaying',
  relaying: 'relaying',
  relayed: 'filling',
  posting_execution: 'filling',
  posted_execution: 'filling',
  solved: 'filled',
  failed: 'failed',
};

const SOLVER_PHASE: Partial<Record<SolverIntentStatusCode, IntentPhase>> = {
  [SolverIntentStatusCode.NOT_FOUND]: 'relaying', // not on the hub yet
  [SolverIntentStatusCode.SOLVED]: 'filled',
  [SolverIntentStatusCode.FAILED]: 'failed',
};

/** Where a vault swap is, from either status source (the backend submit-tx record, or the solver). */
function phaseOf(status: DetailedLeverageYieldStatus): IntentPhase {
  if (status.source === 'backend') {
    return status.data.abandonedAt ? 'failed' : (BACKEND_PHASE[status.data.status] ?? 'unknown');
  }
  return SOLVER_PHASE[status.data.status] ?? 'filling';
}

/** Stop polling after this many reads (~10 min) so an unresolvable status doesn't poll forever. */
const MAX_STATUS_POLLS = 60;

/**
 * Live status of a vault swap from its source-chain tx. Polls until filled, until failed when `stopOnFailed` (an SDK
 * vaultSwap may still recover via its client-side relay after a backend failure), or until MAX_STATUS_POLLS.
 */
export function useIntentStatus(srcChainKey: SpokeChainKey, srcTxHash: string | undefined, stopOnFailed = true) {
  const { apiConfig } = useTransport();
  const { data } = useLeverageYieldDetailedStatus({
    params: { srcChainKey, srcTxHash, apiConfig },
    queryOptions: {
      refetchInterval: query => {
        const result = query.state.data;
        const phase = result?.ok ? phaseOf(result.value) : 'unknown';
        if (phase === 'filled' || (phase === 'failed' && stopOnFailed)) return false;
        return query.state.dataUpdateCount + query.state.errorUpdateCount < MAX_STATUS_POLLS
          ? STATUS_REFETCH_MS
          : false;
      },
    },
  });
  if (!data?.ok) return { phase: 'unknown' as IntentPhase, message: undefined, fillTxHash: undefined };
  const status = data.value;
  return {
    phase: phaseOf(status),
    message: status.source === 'backend' ? (status.data.userMessage ?? status.data.failureReason) : undefined,
    fillTxHash: status.source === 'backend' ? status.data.result?.fillTxHash : status.data.fill_tx_hash,
  };
}
