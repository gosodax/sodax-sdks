/**
 * Runnable `SodaxLogger` example for a backend / Node integration; companion to
 * `packages/sdk/docs/LOGGING.md`. Needs no key, RPC or network: the backend base URL points at a
 * closed local port so a real internal SDK failure travels through the sink immediately.
 * Run with `pnpm --filter node logging`.
 */

import { Sodax, type SodaxLogger } from '@sodax/sdk';

// `data` records carry `bigint` amounts, which `JSON.stringify` rejects; a log call must never throw.
const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;

const hasToJSON = (value: unknown): value is { toJSON: () => unknown } =>
  typeof value === 'object' && value !== null && typeof (value as { toJSON?: unknown }).toJSON === 'function';

/** `SodaxError.toJSON()` is the canonical serialization surface; a plain `Error` would serialize as `{}`. */
function serializeError(error: unknown): unknown {
  if (hasToJSON(error)) return error.toJSON();
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return error;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function createNdjsonLogger(): SodaxLogger {
  const write = (level: Level, message: string, data?: Record<string, unknown>, error?: unknown): void => {
    try {
      const line = {
        level,
        message,
        ...(data ?? {}),
        ...(error !== undefined ? { err: serializeError(error) } : {}),
      };
      process.stdout.write(`${JSON.stringify(line, bigintReplacer)}\n`);
    } catch {
      // A failed log line must not take the SDK call down with it.
    }
  };

  return {
    debug: (message, data) => write('debug', message, data),
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, error, data) => write('error', message, data, error),
  };
}

const logger = createNdjsonLogger();

const sodax = new Sodax({
  logger,
  api: {
    // A closed port, so the request fails locally with no network round trip.
    baseApiConfig: { baseURL: 'http://127.0.0.1:1' },
  },
});

async function main(): Promise<void> {
  sodax.config.logger.info('logger wired', { custom: sodax.config.logger === logger });
  sodax.config.logger.info('starting backend read', { endpoint: 'getChains' });

  // The backend client logs through the configured sink before the failure surfaces as a `Result`.
  const result = await sodax.api.getChains();

  if (!result.ok) {
    sodax.config.logger.warn('backend read failed as expected', { reason: String(result.error) });
  }
}

main().catch(error => {
  logger.error('unhandled failure in logging example', error);
  process.exitCode = 1;
});
