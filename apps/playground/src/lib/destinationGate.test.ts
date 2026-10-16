import { describe, expect, it, vi } from 'vitest';
import { resolveDestinationGate, type NearGateView, type StellarGateView } from './destinationGate';

const stellarOff: StellarGateView = {
  isStellar: false,
  needsActivation: false,
  needsFunding: false,
  needsTrustline: false,
  checkFailed: false,
  blocksAction: false,
  isChecking: false,
  isActivating: false,
  isRequestingTrustline: false,
  activate: vi.fn(),
  requestTrustline: vi.fn(),
};

const nearOff: NearGateView = {
  isNear: false,
  needsRegistration: false,
  blocksAction: false,
  isChecking: false,
  isRegistering: false,
  registerStorage: vi.fn(),
};

const stellar = (over: Partial<StellarGateView>): StellarGateView => ({ ...stellarOff, isStellar: true, ...over });
const near = (over: Partial<NearGateView>): NearGateView => ({ ...nearOff, isNear: true, ...over });

describe('resolveDestinationGate', () => {
  it('stays open for a destination with no prerequisites', () => {
    expect(resolveDestinationGate(stellarOff, nearOff)).toEqual({
      blocked: false,
      notice: undefined,
      action: undefined,
      busy: false,
    });
  });

  // The gate blocks while the check is in flight, so a swap cannot be signed before the answer.
  it('blocks and says so while the Stellar check is unresolved', () => {
    const gate = resolveDestinationGate(stellar({ blocksAction: true, isChecking: true }), nearOff);
    expect(gate.blocked).toBe(true);
    expect(gate.notice).toContain('Checking');
    expect(gate.action).toBeUndefined();
  });

  it('offers activation for an unactivated Stellar account', () => {
    const activate = vi.fn();
    const gate = resolveDestinationGate(stellar({ blocksAction: true, needsActivation: true, activate }), nearOff);
    expect(gate.blocked).toBe(true);
    expect(gate.action?.label).toBe('Activate account');
    gate.action?.run();
    expect(activate).toHaveBeenCalled();
  });

  it('offers a trustline when the account exists but cannot hold the asset', () => {
    const requestTrustline = vi.fn();
    const gate = resolveDestinationGate(
      stellar({ blocksAction: true, needsTrustline: true, requestTrustline }),
      nearOff,
    );
    expect(gate.action?.label).toBe('Add trustline');
    gate.action?.run();
    expect(requestTrustline).toHaveBeenCalled();
  });

  // Funding needs XLM the widget cannot supply, so it explains without offering a button.
  it('explains a Stellar account that lacks XLM without offering an action', () => {
    const gate = resolveDestinationGate(stellar({ blocksAction: true, needsFunding: true }), nearOff);
    expect(gate.blocked).toBe(true);
    expect(gate.notice).toContain('spendable XLM');
    expect(gate.action).toBeUndefined();
  });

  it('surfaces a failed Stellar check rather than a prerequisite', () => {
    const gate = resolveDestinationGate(stellar({ blocksAction: true, checkFailed: true }), nearOff);
    expect(gate.notice).toContain('Could not check');
    expect(gate.action).toBeUndefined();
  });

  // Activation must win: an unactivated account also reports a missing trustline.
  it('asks for activation before a trustline when both are unmet', () => {
    const gate = resolveDestinationGate(
      stellar({ blocksAction: true, needsActivation: true, needsTrustline: true }),
      nearOff,
    );
    expect(gate.action?.label).toBe('Activate account');
  });

  it('offers storage registration for an unregistered NEAR account', () => {
    const registerStorage = vi.fn();
    const gate = resolveDestinationGate(
      stellarOff,
      near({ blocksAction: true, needsRegistration: true, registerStorage }),
    );
    expect(gate.blocked).toBe(true);
    expect(gate.action?.label).toBe('Register storage');
    gate.action?.run();
    expect(registerStorage).toHaveBeenCalled();
  });

  it('reports the in-flight remediation as busy', () => {
    expect(resolveDestinationGate(stellar({ blocksAction: true, isActivating: true }), nearOff).busy).toBe(true);
    expect(resolveDestinationGate(stellarOff, near({ blocksAction: true, isRegistering: true })).busy).toBe(true);
  });

  it('does not block a Stellar destination whose prerequisites are met', () => {
    expect(resolveDestinationGate(stellar({}), nearOff).blocked).toBe(false);
    expect(resolveDestinationGate(stellarOff, near({})).blocked).toBe(false);
  });

  // The remedy's own failure is the one thing the visitor cannot see otherwise: the button stays
  // the same and the gate stays blocked, so the notice has to carry it.
  it('reports a failed preparation in place of the prerequisite notice and keeps the action', () => {
    const declined = resolveDestinationGate(stellar({ blocksAction: true, needsTrustline: true }), nearOff, {
      ok: false,
      error: new Error('User rejected the request'),
    });
    expect(declined.blocked).toBe(true);
    expect(declined.notice).toBe('Request declined in your wallet. You can try again.');
    expect(declined.action?.label).toBe('Add trustline');

    const failed = resolveDestinationGate(stellarOff, near({ blocksAction: true, needsRegistration: true }), {
      ok: false,
      error: new Error('storage_deposit failed'),
    });
    expect(failed.notice).toBe('storage_deposit failed');
    expect(failed.action?.label).toBe('Register storage');
  });

  it('ignores a successful preparation, and a failure once no remedy is offered', () => {
    const unmet = stellar({ blocksAction: true, needsTrustline: true });
    expect(resolveDestinationGate(unmet, nearOff, { ok: true, value: 'tx' }).notice).toContain('trustline');

    const failure = { ok: false, error: new Error('boom') } as const;
    expect(resolveDestinationGate(stellar({}), nearOff, failure).notice).toBeUndefined();
    expect(
      resolveDestinationGate(stellar({ blocksAction: true, needsFunding: true }), nearOff, failure).notice,
    ).toContain('spendable XLM');
  });
});
