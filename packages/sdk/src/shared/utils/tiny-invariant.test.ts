import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { assertOk, invariant } from './tiny-invariant.js';

describe('tiny-invariant', () => {
  it('should correctly narrow a type (boolean)', _done => {
    try {
      const value: boolean = false;

      invariant(value, 'Value is false');
      // this will never be hit as value is false, but it is showing
      // that in order to get to this point the type would need to be true
      expectTypeOf<never>(value);
    } catch {
      // Ensures that invariant has thrown and goes through the catch block.
      expect(true).toBe(true);
    }
  });

  it('should correctly narrow a type (custom type)', () => {
    type Nullable<T> = T | null;
    type Person = { name: string };

    function tryGetPerson(name: string): Nullable<Person> {
      return { name };
    }

    const alex: Nullable<Person> = tryGetPerson('Alex');

    invariant(alex);
    expectTypeOf<Person>(alex);
  });

  it('should not throw if condition is truthy', () => {
    const truthy: unknown[] = [1, -1, true, {}, [], Symbol(), 'hi'];
    truthy.forEach((value: unknown) => {
      expect(() => invariant(value)).not.toThrow();
    });
  });

  it('should throw if the condition is falsy', () => {
    // https://github.com/getify/You-Dont-Know-JS/blob/master/types%20%26%20grammar/ch4.md#falsy-values
    const falsy: unknown[] = [undefined, null, false, +0, -0, Number.NaN, ''];
    falsy.forEach((value: unknown) => {
      expect(() => invariant(value)).toThrow();
    });
  });

  it('should include a default message when an invariant does throw and no message is provided', () => {
    try {
      invariant(false);
    } catch (e) {
      invariant(e instanceof Error);
      expect(e.message).toEqual('Invariant failed');
    }
  });

  it('should include a provided message when an invariant does throw', () => {
    try {
      invariant(false, 'my message');
    } catch (e) {
      invariant(e instanceof Error);
      expect(e.message).toEqual('Invariant failed: my message');
    }
  });

  it('should not execute a message function if the invariant does not throw', () => {
    const message = vi.fn(() => 'lazy message');
    invariant(true, message);
    expect(message).not.toHaveBeenCalled();
  });

  it('should execute a message function if the invariant does throw', () => {
    const message = vi.fn(() => 'lazy message');
    try {
      invariant(false, message);
    } catch (e) {
      invariant(e instanceof Error);
      expect(message).toHaveBeenCalled();
      expect(e.message).toEqual('Invariant failed: lazy message');
    }
  });
});

describe('assertOk', () => {
  it('does not throw when condition is truthy', () => {
    expect(() => assertOk(1, () => new Error('should not run'))).not.toThrow();
    expect(() => assertOk('yes', () => new Error('should not run'))).not.toThrow();
    expect(() => assertOk({}, () => new Error('should not run'))).not.toThrow();
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

  it('does not call the factory when condition is truthy (lazy)', () => {
    const factory = vi.fn(() => new Error('lazy'));
    assertOk(true, factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it('narrows the asserted type', () => {
    type Person = { name: string };
    const value: Person | null = { name: 'Alex' };
    assertOk(value, () => new Error('not a person'));
    expectTypeOf<Person>(value);
  });
});
