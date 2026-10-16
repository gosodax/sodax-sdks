import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent, Result } from '@sodax/types';
import { resolveAnalytics } from './analytics.js';

// Capture every event a resolved emitter delivers to the consumer tracker.
function makeTracker() {
  const events: AnalyticsEvent[] = [];
  return { tracker: (event: AnalyticsEvent) => events.push(event), events };
}

const ok: Result<{ tx: string }, never> = { ok: true, value: { tx: '0xabc' } };

describe('resolveAnalytics — disabled', () => {
  it('returns a no-op emitter for `false` and `undefined`', () => {
    for (const option of [false, undefined] as const) {
      const a = resolveAnalytics(option);
      expect(a.isEnabled('swap')).toBe(false);
      // emit must not throw and must deliver nothing (no tracker exists to call).
      expect(() => a.emit('swap', 'swap', 'start')).not.toThrow();
    }
  });
});

describe('resolveAnalytics — feature/action allowlist', () => {
  it('tracks everything when `features` is omitted', () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker });
    a.emit('swap', 'swap', 'start');
    a.emit('moneyMarket', 'supply', 'start');
    expect(events).toHaveLength(2);
    expect(a.isEnabled('staking', 'stake')).toBe(true);
  });

  it('array shorthand: only listed features emit, others are off', () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker, features: ['swap'] });
    a.emit('swap', 'swap', 'start');
    a.emit('moneyMarket', 'supply', 'start'); // gated out
    expect(events.map(e => e.feature)).toEqual(['swap']);
    expect(a.isEnabled('moneyMarket', 'supply')).toBe(false);
  });

  it('object form: `true` tracks all actions, omitted feature is off', () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker, features: { swap: true } });
    a.emit('swap', 'swap', 'start');
    a.emit('staking', 'stake', 'start'); // omitted → off
    expect(events.map(e => e.feature)).toEqual(['swap']);
  });

  it('object form: `{ actions }` tracks only the named actions', () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker, features: { moneyMarket: { actions: ['supply', 'borrow'] } } });
    a.emit('moneyMarket', 'supply', 'start');
    a.emit('moneyMarket', 'borrow', 'start');
    a.emit('moneyMarket', 'withdraw', 'start'); // not in the action allowlist
    expect(events.map(e => e.action)).toEqual(['supply', 'borrow']);
    expect(a.isEnabled('moneyMarket', 'withdraw')).toBe(false);
    expect(a.isEnabled('moneyMarket', 'supply')).toBe(true);
  });
});

describe('resolveAnalytics — level gating', () => {
  it('suppresses `detailed` events when configured level is `basic` (default)', () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker });
    a.emit('swap', 'swap', 'start', undefined, 'detailed'); // gated out at basic
    a.emit('swap', 'swap', 'start', undefined, 'basic');
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe('basic');
  });

  it('emits `detailed` events when configured level is `detailed`', () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker, level: 'detailed' });
    a.emit('swap', 'swap', 'start', undefined, 'detailed');
    expect(events).toHaveLength(1);
  });
});

describe('resolveAnalytics — robustness & laziness', () => {
  it('never builds the payload thunk when the event is gated out', () => {
    const { tracker } = makeTracker();
    const build = vi.fn(() => ({ a: 1 }));
    const a = resolveAnalytics({ tracker, features: ['swap'] });
    a.emit('moneyMarket', 'supply', 'start', build); // gated out → thunk untouched
    expect(build).not.toHaveBeenCalled();
  });

  it('swallows a throwing tracker so a feature flow is never broken', () => {
    const a = resolveAnalytics({
      tracker: () => {
        throw new Error('boom');
      },
    });
    expect(() => a.emit('swap', 'swap', 'start')).not.toThrow();
  });
});

describe('resolveAnalytics — trackResult', () => {
  it('emits start then success and returns the Result unchanged', async () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker });
    const result = await a.trackResult('swap', 'swap', async () => ok, {
      start: () => ({ phase: 'in' }),
      success: value => ({ tx: value.tx }),
    });
    expect(result).toBe(ok);
    expect(events.map(e => e.phase)).toEqual(['start', 'success']);
    expect(events[1]?.data).toEqual({ tx: '0xabc' });
  });

  it('emits start then failure for an error Result', async () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker });
    const err: Result<never, { code: string }> = { ok: false, error: { code: 'BOOM' } };
    await a.trackResult('swap', 'swap', async () => err, { failure: e => ({ code: e.code }) });
    expect(events.map(e => e.phase)).toEqual(['start', 'failure']);
    expect(events[1]?.data).toEqual({ code: 'BOOM' });
  });

  it('does not emit when the feature is gated out of the allowlist', async () => {
    const { tracker, events } = makeTracker();
    const a = resolveAnalytics({ tracker, features: ['bridge'] });
    await a.trackResult('swap', 'swap', async () => ok);
    expect(events).toHaveLength(0);
  });
});
