/** Compile-time contract for `logger.ts`: every logger option resolves to a `SodaxLogger`. */
import { describe, expectTypeOf, it } from 'vitest';
import type { SodaxLogger, SodaxLoggerOption } from '../index.js';
import { consoleLogger, resolveLogger, silentLogger } from './logger.js';

declare const customLogger: SodaxLogger;
const resolved = () =>
  [resolveLogger(undefined), resolveLogger('console'), resolveLogger('silent'), resolveLogger(customLogger)] as const;
const invalid = () =>
  // @ts-expect-error — only the 'console' / 'silent' presets or a SodaxLogger are accepted
  resolveLogger('verbose');

describe('logger type contract', () => {
  it('resolveLogger returns a SodaxLogger for every option', () => {
    expectTypeOf(resolveLogger).parameter(0).toEqualTypeOf<SodaxLoggerOption | undefined>();
    expectTypeOf<ReturnType<typeof resolved>>().toEqualTypeOf<
      readonly [SodaxLogger, SodaxLogger, SodaxLogger, SodaxLogger]
    >();
    expectTypeOf(invalid).returns.toEqualTypeOf<SodaxLogger>();
  });

  it('presets are SodaxLoggers', () => {
    expectTypeOf(consoleLogger).toEqualTypeOf<SodaxLogger>();
    expectTypeOf(silentLogger).toEqualTypeOf<SodaxLogger>();
  });
});
