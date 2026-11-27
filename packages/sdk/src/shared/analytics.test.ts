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

  it('array shorthand and object `true`: listed features track all actions, omitted features are off', () => {
    const array = makeTracker();
    const a = resolveAnalytics({ tracker: array.tracker, features: ['swap'] });
    a.emit('swap', 'swap', 'start');
    a.emit('moneyMarket', 'supply', 'start'); // gated out
    expect(array.events.map(e => e.feature)).toEqual(['swap']);
    expect(a.isEnabled('moneyMarket', 'supply')).toBe(false);

    const object = makeTracker();
    const b = resolveAnalytics({ tracker: object.tracker, features: { swap: true } });
    b.emit('swap', 'swap', 'start');
    b.emit('staking', 'stake', 'start'); // omitted → off
    expect(object.events.map(e => e.feature)).toEqual(['swap']);
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
  it('suppresses `detailed` events at the default `basic` level and emits them at level `detailed`', () => {
    const basic = makeTracker();
    const a = resolveAnalytics({ tracker: basic.tracker });
    a.emit('swap', 'swap', 'start', undefined, 'detailed'); // gated out at basic
    a.emit('swap', 'swap', 'start', undefined, 'basic');
    expect(basic.events).toHaveLength(1);
    expect(basic.events[0]?.level).toBe('basic');

    const detailed = makeTracker();
    resolveAnalytics({ tracker: detailed.tracker, level: 'detailed' }).emit(
      'swap',
      'swap',
      'start',
      undefined,
      'detailed',
    );
    expect(detailed.events).toHaveLength(1);
  });
});

describe('resolveAnalytics — robustness & laziness', () => {
  it('never builds the payload thunk or emits from trackResult when the feature is gated out', async () => {
    const { tracker, events } = makeTracker();
    const build = vi.fn(() => ({ a: 1 }));
    const a = resolveAnalytics({ tracker, features: ['bridge'] });
    a.emit('moneyMarket', 'supply', 'start', build); // gated out → thunk untouched
    expect(build).not.toHaveBeenCalled();
    await a.trackResult('swap', 'swap', async () => ok);
    expect(events).toHaveLength(0);
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
  it('emits start then success / failure and returns the Result unchanged', async () => {
    const success = makeTracker();
    const result = await resolveAnalytics({ tracker: success.tracker }).trackResult('swap', 'swap', async () => ok, {
      start: () => ({ phase: 'in' }),
      success: value => ({ tx: value.tx }),
    });
    expect(result).toBe(ok);
    expect(success.events.map(e => e.phase)).toEqual(['start', 'success']);
    expect(success.events[1]?.data).toEqual({ tx: '0xabc' });

    const failure = makeTracker();
    const err: Result<never, { code: string }> = { ok: false, error: { code: 'BOOM' } };
    const failed = await resolveAnalytics({ tracker: failure.tracker }).trackResult('swap', 'swap', async () => err, {
      failure: e => ({ code: e.code }),
    });
    expect(failed).toBe(err);
    expect(failure.events.map(e => e.phase)).toEqual(['start', 'failure']);
    expect(failure.events[1]?.data).toEqual({ code: 'BOOM' });
  });
});
