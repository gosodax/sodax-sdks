/**
 * SDK diagnostics sink used instead of `console.*`; `error()` takes the thrown value separately from `data`
 * so adapters can attach it as the exception (e.g. `Sentry.captureException(error, { extra: data })`).
 */
export interface SodaxLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
}

/** `'console'` is the default; `'silent'` drops all SDK logs. */
export type SodaxLoggerOption = SodaxLogger | 'console' | 'silent';
