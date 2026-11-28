import type { SodaxLogger, SodaxLoggerOption } from '@sodax/types';

/** Mirrors the SDK's historical `console.*` output; `data` is appended only when present. */
export const consoleLogger: SodaxLogger = {
  debug: (message, data) => (data ? console.debug(message, data) : console.debug(message)),
  info: (message, data) => (data ? console.info(message, data) : console.info(message)),
  warn: (message, data) => (data ? console.warn(message, data) : console.warn(message)),
  error: (message, error, data) => {
    if (error !== undefined && data !== undefined) console.error(message, error, data);
    else if (error !== undefined) console.error(message, error);
    else console.error(message);
  },
};

export const silentLogger: SodaxLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Defaults to {@link consoleLogger}: logging is on unless opted out. */
export function resolveLogger(option: SodaxLoggerOption | undefined): SodaxLogger {
  if (option === undefined || option === 'console') return consoleLogger;
  if (option === 'silent') return silentLogger;
  return option;
}
