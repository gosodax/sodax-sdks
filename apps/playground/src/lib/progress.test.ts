import { describe, expect, it } from 'vitest';
import { PHASE_LABELS, STATUS_LABELS, failureMessage, progressLabel, refundAccounted } from './progress';

describe('progressLabel', () => {
  it('names every step the confirm dialog can be showing', () => {
    for (const label of [...Object.values(PHASE_LABELS), ...Object.values(STATUS_LABELS)]) {
      expect(label).toMatch(/\S/);
    }
  });

  it('keeps the wallet prompt visible once the relay starts reporting', () => {
    expect(progressLabel('signing', 'pending')).toBe(PHASE_LABELS.signing);
  });

  it('follows the relay once the widget has no step of its own', () => {
    expect(progressLabel(undefined, 'relaying')).toBe(STATUS_LABELS.relaying);
  });

  it('has nothing to say before a swap is under way', () => {
    expect(progressLabel(undefined, undefined)).toBeUndefined();
  });
});

describe('failureMessage', () => {
  // The widget only ever creates timed intents, so it must never send anyone cancelling on-chain.
  it('never asks the visitor to cancel anything', () => {
    const every = [
      failureMessage(undefined),
      failureMessage({}),
      failureMessage({ relayedForRefundAt: '2026-09-16T14:08:00Z' }),
      failureMessage({ intentCancelled: true }),
    ];
    for (const message of every) {
      expect(message).not.toMatch(/\bcancel\b/i);
      expect(message).not.toMatch(/\blocked\b|\bsupport\b/i);
    }
  });

  it('says the funds are already back once the intent is cancelled on-chain', () => {
    expect(failureMessage({ intentCancelled: true })).toMatch(/back in your wallet/);
  });

  it('says the refund is moving once it has been relayed', () => {
    expect(failureMessage({ relayedForRefundAt: '2026-09-16T14:08:00Z' })).toMatch(/on its way/);
  });

  // An expiring intent refunds itself, so an unreported one still gets a wait, not a warning.
  it('promises the automatic refund when the backend has reported neither', () => {
    expect(failureMessage({})).toMatch(/automatically/);
  });

  it('prefers the settled outcome over the one still in flight', () => {
    expect(failureMessage({ intentCancelled: true, relayedForRefundAt: '2026-09-16T14:08:00Z' })).toMatch(
      /back in your wallet/,
    );
  });
});

describe('refundAccounted', () => {
  // What gates the support link: offering help beside "your funds are back" invents a problem, and
  // an embedded widget should send a partner's customer to SODAX as rarely as it honestly can.
  it('is settled once the intent is cancelled or the refund is relayed', () => {
    expect(refundAccounted({ intentCancelled: true })).toBe(true);
    expect(refundAccounted({ relayedForRefundAt: '2026-09-16T14:08:00Z' })).toBe(true);
  });

  it('is unsettled while the backend has reported neither', () => {
    expect(refundAccounted({})).toBe(false);
    expect(refundAccounted(undefined)).toBe(false);
    expect(refundAccounted({ intentCancelled: false })).toBe(false);
  });
});
