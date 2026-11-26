import { ChainKeys, type SpokeChainKey, type XrpDestinationReadiness } from '@sodax/sdk';
import type { UseQueryResult } from '@tanstack/react-query';

/** The subset of a query result the gate reads. A full `UseQueryResult<T>` satisfies it. */
export type XrpCheckResult<T> = Pick<UseQueryResult<T>, 'isLoading' | 'isError' | 'data'>;

/** A destination refusal the account's own trustline cannot fix. */
export type XrpBlockedReason = Exclude<
  Extract<XrpDestinationReadiness, { ready: false }>['reason'],
  'no_trustline' | 'trustline_limit'
>;

export interface XrpGateState {
  /** The destination is XRPL and the token is an issued currency, so a trustline is involved. */
  isXrpIssuedToken: boolean;
  /** The trustline is missing or too small, and the account can afford to set it. */
  needsTrustline: boolean;
  /** The trustline needs setting, but the account lacks the spendable XRP for its fee and reserve. */
  needsFunding: boolean;
  /** Why the destination cannot receive, when no trustline change by the user would fix it. */
  blockedReason: XrpBlockedReason | undefined;
  /** A query failed; disabled or unresolved queries do not set this. */
  checkFailed: boolean;
  /** Whether the downstream action must remain disabled. */
  blocksAction: boolean;
}

export interface XrpGateInputs {
  /** Whether the destination can receive the payout, from the same ledger reads the SDK refuses a swap on. */
  readinessCheck: XrpCheckResult<XrpDestinationReadiness>;
  /** Whether the account can pay for the TrustSet. Only read once the trustline is known to need setting. */
  reserveCheck: XrpCheckResult<boolean>;
  /** Resolve from chain config: false for native XRP. */
  requiresTrustline: boolean;
}

const NOT_XRP_ISSUED_TOKEN: XrpGateState = {
  isXrpIssuedToken: false,
  needsTrustline: false,
  needsFunding: false,
  blockedReason: undefined,
  checkFailed: false,
  blocksAction: false,
};

function unresolved<T>(check: XrpCheckResult<T>): boolean {
  return check.isLoading || check.data === undefined;
}

/**
 * Resolve the XRPL destination prerequisites for an issued token. Native XRP and other chains pass through:
 * the SDK still refuses an unreceivable payout before signing. Unknown states fail closed.
 */
export function resolveXrpGate(chainKey: SpokeChainKey | undefined, inputs: XrpGateInputs): XrpGateState {
  const { readinessCheck, reserveCheck, requiresTrustline } = inputs;
  if (chainKey !== ChainKeys.XRP_MAINNET || !requiresTrustline) return NOT_XRP_ISSUED_TOKEN;
  const base = { ...NOT_XRP_ISSUED_TOKEN, isXrpIssuedToken: true };

  if (readinessCheck.isError) return { ...base, checkFailed: true, blocksAction: true };
  const readiness = readinessCheck.data;
  if (readinessCheck.isLoading || readiness === undefined) return { ...base, blocksAction: true };
  if (readiness.ready) return base;

  if (readiness.reason !== 'no_trustline' && readiness.reason !== 'trustline_limit') {
    return { ...base, blockedReason: readiness.reason, blocksAction: true };
  }

  if (reserveCheck.isError) return { ...base, checkFailed: true, blocksAction: true };
  if (unresolved(reserveCheck)) return { ...base, blocksAction: true };
  if (reserveCheck.data !== true) return { ...base, needsFunding: true, blocksAction: true };
  return { ...base, needsTrustline: true, blocksAction: true };
}
