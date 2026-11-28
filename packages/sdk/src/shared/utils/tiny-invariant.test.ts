import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { assertOk, invariant } from './tiny-invariant.js';

describe('tiny-invariant', () => {
  it('should throw only if the condition is falsy', () => {
    const truthy: unknown[] = [1, -1, true, {}, [], Symbol(), 'hi'];
    truthy.forEach((value: unknown) => {
      expect(() => invariant(value)).not.toThrow();
    });
    // https://github.com/getify/You-Dont-Know-JS/blob/master/types%20%26%20grammar/ch4.md#falsy-values
    const falsy: unknown[] = [undefined, null, false, +0, -0, Number.NaN, ''];
    falsy.forEach((value: unknown) => {
      expect(() => invariant(value)).toThrow();
    });
  });

  it('should include a default message when none is provided, else the provided message', () => {
    expect(() => invariant(false)).toThrow(new Error('Invariant failed'));
    expect(() => invariant(false, 'my message')).toThrow(new Error('Invariant failed: my message'));
  });

  it('should execute a message function only if the invariant throws', () => {
    const message = vi.fn(() => 'lazy message');
    invariant(true, message);
    expect(message).not.toHaveBeenCalled();
    expect(() => invariant(false, message)).toThrow(new Error('Invariant failed: lazy message'));
    expect(message).toHaveBeenCalled();
  });
});

describe('assertOk', () => {
  it('does not throw or call the factory when the condition is truthy, and narrows the asserted type', () => {
    expect(() => assertOk(1, () => new Error('should not run'))).not.toThrow();
    expect(() => assertOk('yes', () => new Error('should not run'))).not.toThrow();
    const factory = vi.fn(() => new Error('lazy'));
    assertOk({}, factory);
    expect(factory).not.toHaveBeenCalled();

    type Person = { name: string };
    const value: Person | null = { name: 'Alex' };
    assertOk(value, () => new Error('not a person'));
    expectTypeOf<Person>(value);
  });

  it('throws the factory-produced error when condition is falsy', () => {
    class CustomError extends Error {
      readonly code = 'CUSTOM' as const;
    }
    const factory = () => new CustomError('boom');
    try {
      assertOk(0, factory);
      expect.fail('expected assertOk to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CustomError);
      expect((e as CustomError).code).toBe('CUSTOM');
      expect((e as Error).message).toBe('boom');
    }
  });
});
