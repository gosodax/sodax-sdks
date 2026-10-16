import type { Result } from '@sodax/dapp-kit';
import { executionError } from './execution';

/**
 * Some destinations can accept a swap the recipient cannot actually receive: a Stellar account that
 * is not activated or lacks a trustline, or a NEAR account with no NEP-141 storage registered. The
 * swap would leave the source chain and strand, so the widget blocks before signing rather than
 * after. Every field mirrors the dapp-kit gate hooks; this reduces them to one thing the UI renders.
 */

/** Never rejects: the SDK result, or `undefined` when the hook had no inputs to act on. */
export type Preparation = () => Promise<Result<unknown> | undefined>;

export type GateAction = { label: string; run: Preparation };

export type DestinationGate = {
  /** Execution must stay disabled: the gate is unmet, or still resolving. */
  blocked: boolean;
  notice: string | undefined;
  /** Present only when the visitor can clear the gate from inside the widget. */
  action: GateAction | undefined;
  busy: boolean;
};

export type StellarGateView = {
  isStellar: boolean;
  needsActivation: boolean;
  needsFunding: boolean;
  needsTrustline: boolean;
  checkFailed: boolean;
  blocksAction: boolean;
  isChecking: boolean;
  isActivating: boolean;
  isRequestingTrustline: boolean;
  activate: Preparation;
  requestTrustline: Preparation;
};

export type NearGateView = {
  isNear: boolean;
  needsRegistration: boolean;
  blocksAction: boolean;
  isChecking: boolean;
  isRegistering: boolean;
  registerStorage: Preparation;
};

const OPEN: DestinationGate = { blocked: false, notice: undefined, action: undefined, busy: false };

function stellarNotice(gate: StellarGateView): Pick<DestinationGate, 'notice' | 'action'> {
  if (gate.checkFailed) {
    return { notice: 'Could not check the receiving Stellar account. Try again before swapping.', action: undefined };
  }
  if (gate.needsActivation) {
    return {
      notice: 'The receiving Stellar account is not activated yet. Activate it before swapping.',
      action: { label: 'Activate account', run: gate.activate },
    };
  }
  // Funding is the one Stellar case the widget cannot clear: it needs XLM the recipient must supply.
  if (gate.needsFunding) {
    return {
      notice: 'The receiving Stellar account needs spendable XLM before it can hold this asset.',
      action: undefined,
    };
  }
  if (gate.needsTrustline) {
    return {
      notice: 'The receiving Stellar account needs a trustline for this asset.',
      action: { label: 'Add trustline', run: gate.requestTrustline },
    };
  }
  return { notice: gate.isChecking ? 'Checking the receiving Stellar account…' : undefined, action: undefined };
}

function nearNotice(gate: NearGateView): Pick<DestinationGate, 'notice' | 'action'> {
  if (gate.needsRegistration) {
    return {
      notice: 'The receiving NEAR account is not registered to hold this token.',
      action: { label: 'Register storage', run: gate.registerStorage },
    };
  }
  return { notice: gate.isChecking ? 'Checking the receiving NEAR account…' : undefined, action: undefined };
}

function resolvePrerequisite(stellar: StellarGateView, near: NearGateView): DestinationGate {
  if (stellar.isStellar) {
    return {
      blocked: stellar.blocksAction,
      busy: stellar.isActivating || stellar.isRequestingTrustline,
      ...stellarNotice(stellar),
    };
  }
  if (near.isNear) {
    return { blocked: near.blocksAction, busy: near.isRegistering, ...nearNotice(near) };
  }
  return OPEN;
}

/**
 * `lastPreparation` is what the most recent `action.run` resolved to. A failure — a declined wallet
 * prompt, a rejected transaction — takes the notice for as long as the same remedy is still offered.
 */
export function resolveDestinationGate(
  stellar: StellarGateView,
  near: NearGateView,
  lastPreparation?: Result<unknown>,
): DestinationGate {
  const gate = resolvePrerequisite(stellar, near);
  const failure = lastPreparation && !lastPreparation.ok ? executionError(lastPreparation.error) : undefined;
  return failure && gate.action ? { ...gate, notice: failure } : gate;
}
