import { describe, expect, it, vi } from 'vitest';
import type { SodaxLogger } from '@sodax/types';
import { consoleLogger, resolveLogger, silentLogger } from './logger.js';
import { Sodax } from './entities/Sodax.js';

describe('resolveLogger', () => {
  it("resolves undefined and 'console' to the console logger, 'silent' to the silent logger, and a custom instance unchanged", () => {
    expect(resolveLogger(undefined)).toBe(consoleLogger);
    expect(resolveLogger('console')).toBe(consoleLogger);
    expect(resolveLogger('silent')).toBe(silentLogger);
    const custom: SodaxLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(resolveLogger(custom)).toBe(custom);
  });
});

describe('consoleLogger', () => {
  it('forwards error(message, error) to console.error, omitting the second argument when no error is passed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('boom');
    consoleLogger.error('failed', cause);
    expect(spy).toHaveBeenLastCalledWith('failed', cause);
    consoleLogger.error('just a message');
    expect(spy).toHaveBeenLastCalledWith('just a message');
    spy.mockRestore();
  });

  for (const level of ['debug', 'info', 'warn'] as const) {
    it(`forwards ${level}(message, data) to console.${level}, omitting the second argument when no data is passed`, () => {
      const spy = vi.spyOn(console, level).mockImplementation(() => {});
      const data = { k: 'v' };
      consoleLogger[level]('a message', data);
      expect(spy).toHaveBeenLastCalledWith('a message', data);
      consoleLogger[level]('a message');
      expect(spy).toHaveBeenLastCalledWith('a message');
      spy.mockRestore();
    });
  }
});

describe('Sodax logger wiring', () => {
  it('uses a custom logger and keeps it across initialize()', async () => {
    const custom: SodaxLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const sodax = new Sodax({ logger: custom });
    expect(sodax.config.logger).toBe(custom);

    // The resolved sink lives outside the swappable SodaxConfig, so initialize() never replaces it.
    // (initialize() is currently a no-op pending the v2 config endpoint; the guarantee holds either way.)
    await sodax.initialize();
    expect(sodax.config.logger).toBe(custom);
  });
});
