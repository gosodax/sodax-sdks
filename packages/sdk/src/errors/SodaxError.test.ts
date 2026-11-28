import { describe, expect, it } from 'vitest';
import { SodaxError, isSodaxError, type SodaxErrorJSON } from './SodaxError.js';

describe('SodaxError', () => {
  describe('toJSON()', () => {
    it('produces the canonical shape including feature field and a captured stack', () => {
      const err = new SodaxError('VALIDATION_FAILED', 'a message', {
        feature: 'swap',
        context: { foo: 'bar' },
      });
      const json = err.toJSON();

      expect(json.name).toBe('SodaxError');
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.feature).toBe('swap');
      expect(json.message).toBe('a message');
      expect(json.context).toEqual({ foo: 'bar' });
      expect(typeof json.stack).toBe('string');
      expect(err.stack && err.stack.length > 0).toBe(true);
    });

    it('serializes a plain Error cause as { name, message, stack } and coerces non-Error causes to a string', () => {
      const inner = new Error('inner');
      const err = new SodaxError('UNKNOWN', 'outer', { feature: 'swap', cause: inner });
      const cause = err.toJSON().cause as { name: string; message: string; stack?: string };

      expect(cause.name).toBe('Error');
      expect(cause.message).toBe('inner');
      expect(typeof cause.stack).toBe('string');

      expect(new SodaxError('UNKNOWN', 'x', { feature: 'swap', cause: 42 }).toJSON().cause).toBe('42');
    });

    it('inlines a SodaxError cause including its feature (does not call cause.toJSON recursively)', () => {
      const inner = new SodaxError('VALIDATION_FAILED', 'inner msg', {
        feature: 'moneyMarket',
        context: { x: 1 },
      });
      const outer = new SodaxError('UNKNOWN', 'outer msg', { feature: 'swap', cause: inner });
      const json = outer.toJSON();
      const cause = json.cause as SodaxErrorJSON;

      expect(cause.name).toBe('SodaxError');
      expect(cause.code).toBe('VALIDATION_FAILED');
      expect(cause.feature).toBe('moneyMarket');
      expect(cause.message).toBe('inner msg');
      expect(cause.context).toEqual({ x: 1 });
    });
  });

  describe('context sanitization', () => {
    it('coerces bigint to string at the top level, inside nested plain objects and inside arrays', () => {
      const err = new SodaxError('UNKNOWN', 'm', {
        feature: 'swap',
        context: { amount: 1_000_000n, nested: { blockNumber: 42n, deeper: { x: 7n } }, hashes: [1n, 2n, 3n] },
      });
      expect(err.toJSON().context).toEqual({
        amount: '1000000',
        nested: { blockNumber: '42', deeper: { x: '7' } },
        hashes: ['1', '2', '3'],
      });
      expect(() => JSON.stringify(err)).not.toThrow();
    });

    it('serializes Date as ISO string, Map as entry array, Set as array, and recurses Object.create(null)', () => {
      const obj = Object.create(null) as Record<string, unknown>;
      obj.amount = 99n;
      const err = new SodaxError('UNKNOWN', 'm', {
        feature: 'swap',
        context: {
          when: new Date('2026-01-01T00:00:00Z'),
          m: new Map<string, bigint>([
            ['a', 1n],
            ['b', 2n],
          ]),
          s: new Set([1n, 2n]),
          obj,
        },
      });
      expect(err.toJSON().context).toEqual({
        when: '2026-01-01T00:00:00.000Z',
        m: [
          ['a', '1'],
          ['b', '2'],
        ],
        s: ['1', '2'],
        obj: { amount: '99' },
      });
    });

    it('class instances become their String() form (no recursion, no throw)', () => {
      class Custom {
        readonly x = 1n;
        toString(): string {
          return 'Custom(1)';
        }
      }
      const err = new SodaxError('UNKNOWN', 'm', {
        feature: 'swap',
        context: { instance: new Custom() },
      });
      expect(err.toJSON().context).toEqual({ instance: 'Custom(1)' });
      expect(() => JSON.stringify(err)).not.toThrow();
    });
  });

  describe('depth bounds', () => {
    it('cause chain is truncated past MAX_CAUSE_DEPTH', () => {
      const a = new SodaxError('UNKNOWN', 'a', { feature: 'swap' });
      const b = new SodaxError('UNKNOWN', 'b', { feature: 'swap', cause: a });
      const c = new SodaxError('UNKNOWN', 'c', { feature: 'swap', cause: b });
      const d = new SodaxError('UNKNOWN', 'd', { feature: 'swap', cause: c });
      const e = new SodaxError('UNKNOWN', 'e', { feature: 'swap', cause: d });

      expect(() => JSON.stringify(e)).not.toThrow();

      const json = e.toJSON();
      const dCause = json.cause as SodaxErrorJSON;
      const cCause = dCause.cause as SodaxErrorJSON;
      const bCause = cCause.cause as SodaxErrorJSON;
      expect(bCause.code).toBe('UNKNOWN');
      expect(bCause.cause).toBe('[max cause depth reached]');
    });

    it('context recursion is truncated past MAX_SANITIZE_DEPTH', () => {
      const deep: Record<string, unknown> = {};
      let cursor: Record<string, unknown> = deep;
      for (let i = 0; i < 7; i++) {
        cursor.next = {};
        cursor = cursor.next as Record<string, unknown>;
      }
      cursor.amount = 1n;

      const err = new SodaxError('UNKNOWN', 'm', { feature: 'swap', context: { deep } });
      expect(() => JSON.stringify(err)).not.toThrow();
    });
  });

  describe('isSodaxError', () => {
    it('returns true for a real SodaxError and for an Error with name=SodaxError, string code and feature (cross-bundle)', () => {
      expect(isSodaxError(new SodaxError('UNKNOWN', 'm', { feature: 'swap' }))).toBe(true);

      const fake = new Error('msg');
      fake.name = 'SodaxError';
      (fake as unknown as { code: string; feature: string }).code = 'UNKNOWN';
      (fake as unknown as { code: string; feature: string }).feature = 'swap';
      expect(isSodaxError(fake)).toBe(true);
    });

    it('returns false for a plain Error, a SodaxError-named Error missing code or feature, and non-Errors', () => {
      expect(isSodaxError(new Error('m'))).toBe(false);

      const noCode = new Error('m');
      noCode.name = 'SodaxError';
      expect(isSodaxError(noCode)).toBe(false);

      const noFeature = new Error('m');
      noFeature.name = 'SodaxError';
      (noFeature as unknown as { code: string }).code = 'X';
      expect(isSodaxError(noFeature)).toBe(false);

      expect(isSodaxError(null)).toBe(false);
      expect(isSodaxError(undefined)).toBe(false);
      expect(isSodaxError('SodaxError')).toBe(false);
      expect(isSodaxError({ code: 'X', name: 'SodaxError', feature: 'swap' })).toBe(false);
    });
  });
});
