# Logging

The SDK routes all of its internal diagnostics through a single `SodaxLogger` instead of calling
`console.*` directly. Pick a preset or forward to a structured sink (Sentry, Pino, Datadog, …) without
patching globals.

## Select a logger at construction

`logger` is a `Sodax` constructor option — a field on `SodaxOptions` (the constructor's parameter
type), kept off the `SodaxConfig` data contract because it is a client-side sink, not backend-fetched
config. It accepts a preset name or a custom implementation:

```ts
import { Sodax } from '@sodax/sdk';

new Sodax();                       // default — same as { logger: 'console' }
new Sodax({ logger: 'console' });  // mirror console.* output
new Sodax({ logger: 'silent' });   // drop all SDK logs
```

The logger is resolved **once** at construction and held on `ConfigService` outside the swappable
dynamic config (read it back as `sodax.config.logger`). `await sodax.config.initialize()` fetches fresh
chain config from the backend but **never** replaces the logger — the backend cannot set or overwrite
it.

> Combine with the other constructor options freely — pass `logger` alongside `chains` / `api` /
> `solver` overrides in the same object. The merged options land on `sodax.instanceConfig` (including the
> `logger` key), but the sink the services use is `sodax.config.logger`. See [`initialize-sodax.md`](initialize-sodax.md).

## Custom sink

Implement the `SodaxLogger` interface and pass the instance:

```ts
import { Sodax, type SodaxLogger } from '@sodax/sdk';

const sentryLogger: SodaxLogger = {
  debug: (message, data) => Sentry.addBreadcrumb({ level: 'debug', message, data }),
  info: (message, data) => Sentry.addBreadcrumb({ level: 'info', message, data }),
  warn: (message, data) => Sentry.captureMessage(message, { level: 'warning', extra: data }),
  error: (message, error, data) =>
    error !== undefined
      ? Sentry.captureException(error, { extra: { message, ...data } })
      : Sentry.captureMessage(message, { level: 'error', extra: data }),
};

const sodax = new Sodax({ logger: sentryLogger });
```

## Interface

```ts
import type { SodaxLogger, SodaxLoggerOption } from '@sodax/sdk';

// SodaxLogger:
//   debug(message: string, data?: Record<string, unknown>): void;
//   info(message: string, data?: Record<string, unknown>): void;
//   warn(message: string, data?: Record<string, unknown>): void;
//   error(message: string, error?: unknown, data?: Record<string, unknown>): void;
//
// SodaxLoggerOption = SodaxLogger | 'console' | 'silent';
```

`error()` takes the thrown value as a separate second argument (before structured `data`) so adapters
can attach it as the exception — `warn` / `info` / `debug` take only `(message, data?)`. SDK errors are
`SodaxError` instances; their `toJSON()` is the canonical serialization surface (`JSON.stringify(error)`
invokes it automatically). For routing a failed `Result<T>`'s `error` into a sink, see the **Logging**
section of [`result-and-errors.md`](result-and-errors.md).

## Built-in loggers and resolver

`consoleLogger`, `silentLogger`, and `resolveLogger(option)` are exported from `@sodax/sdk` for
composition — e.g. wrapping the console logger to add a prefix, or resolving a preset name yourself:

```ts
import { consoleLogger, resolveLogger, type SodaxLogger } from '@sodax/sdk';

// Wrap the default to add a prefix
const prefixed: SodaxLogger = {
  debug: (m, d) => consoleLogger.debug(`[sodax] ${m}`, d),
  info: (m, d) => consoleLogger.info(`[sodax] ${m}`, d),
  warn: (m, d) => consoleLogger.warn(`[sodax] ${m}`, d),
  error: (m, e, d) => consoleLogger.error(`[sodax] ${m}`, e, d),
};

// Resolve a preset name to a concrete logger
const resolved = resolveLogger('silent'); // → silentLogger
```

## Coverage

All instance feature services (swap, bridge, money market, DEX, staking, partner, recovery, the spoke
services), `BackendApiService`, and the solver API client route through the configured logger. A small
number of pure utility / static-helper functions still call `console.*` directly because they have no
access to the instance logger.

## Cross-references

- [`README.md`](README.md) — recipe index.
- [`initialize-sodax.md`](initialize-sodax.md) — the constructor options object `logger` lives in.
- [`result-and-errors.md`](result-and-errors.md) — routing a failed `Result<T>` into a logging sink.
- [`../reference/public-api.md`](../reference/public-api.md) — exported logger symbols.
