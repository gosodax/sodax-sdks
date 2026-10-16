---
title: "Logging"
icon: file-lines
generatedFrom: packages/sdk/docs/LOGGING.md
---

The SDK routes all of its internal diagnostics through a single `SodaxLogger` instead of calling
`console.*` directly. This lets you silence SDK output or forward it to a structured sink (Sentry,
Pino, Datadog, etc.) without patching globals.

React apps have a second, unrelated seam for failed React Query mutations. See
[React mutation errors](#react-mutation-errors) below; most dApps wire both.

## Select a logger at construction

`logger` is a field on `SodaxOptions`, the `Sodax` constructor's parameter type. It accepts a preset
name or a custom implementation:

```typescript
import { Sodax } from '@sodax/sdk';

new Sodax();                       // default — same as { logger: 'console' }
new Sodax({ logger: 'console' });  // mirror the SDK's historical console.* behavior
new Sodax({ logger: 'silent' });   // drop all SodaxLogger output
new Sodax({ logger: myLogger });   // forward to your own sink
```

Pass it alongside any other constructor option:

```typescript
const sodax = new Sodax({
  logger: myLogger,
  api: { baseApiConfig: { baseURL: 'https://api.sodax.com/v1' } },
});
```

The logger is resolved once at construction and held on `ConfigService` independently of the
swappable dynamic config, so `sodax.config.initialize()` cannot replace it and the backend can
neither set nor overwrite it. Read the resolved sink back as `sodax.config.logger`. Note that
`sodax.instanceConfig` is the merged options object and carries the `logger` key too; the sink the
services use is `sodax.config.logger`.

## Interface

```typescript
interface SodaxLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
}

type SodaxLoggerOption = SodaxLogger | 'console' | 'silent';
```

`error()` takes the thrown value as a separate second argument, before structured `data`, so adapters
can attach it as the exception. `warn`, `info` and `debug` take only `(message, data?)`.

## What the SDK emits

| Level | Call sites | Content | Typical adapter mapping |
| --- | --- | --- | --- |
| `error` | 29 | Service-level failures; the second argument is the caught value | `captureException` |
| `warn` | 17 | Recoverable or degraded paths | `captureMessage`, warning level |
| `debug` | 9 | Verbose flow tracing | breadcrumb |
| `info` | 0 | Not emitted today; implement the method anyway | breadcrumb |

Counts cover the non-test sources under `packages/sdk/src`.

There is no level filter. Every call reaches the configured sink, so filtering belongs in the
adapter:

```typescript
import type { SodaxLogger } from '@sodax/sdk';

const ORDER = { debug: 0, info: 1, warn: 2, error: 3 } as const;

const atLeast = (min: keyof typeof ORDER, sink: SodaxLogger): SodaxLogger => ({
  debug: (m, d) => { if (ORDER.debug >= ORDER[min]) sink.debug(m, d); },
  info: (m, d) => { if (ORDER.info >= ORDER[min]) sink.info(m, d); },
  warn: (m, d) => { if (ORDER.warn >= ORDER[min]) sink.warn(m, d); },
  error: (m, e, d) => { if (ORDER.error >= ORDER[min]) sink.error(m, e, d); },
});
```

## Errors reaching the sink

The `error` argument is whatever the service caught: usually the raw transport, viem or wallet error,
occasionally a [`SodaxError`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/src/errors/SodaxError.ts),
and sometimes `undefined` when a site logs a message alone. The `SodaxError` a caller receives in the
failed `Result` is built after the log call, so do not expect it in the sink. Use `isSodaxError(error)`
before tagging on `error.feature`, `error.code` and `error.context.action`, and never parse
`error.message`, which is human-readable and may change.

`SodaxError.toJSON()` is the canonical serialization surface, and `JSON.stringify(error)` invokes it
automatically — including the `bigint` values inside `context`, which it coerces to strings. A plain
`Error` has no `toJSON()` and serializes as `{}`, so an adapter still has to copy `name`, `message`
and `stack` itself, and `bigint` values in `data` still need a replacer (see the constraints below).

See [Errors And Results](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/AGENTS.md#errors-and-results)
for the error contract.

## Built-in loggers

`consoleLogger`, `silentLogger` and `resolveLogger(option)` are exported from `@sodax/sdk` for
composition — wrapping the console logger to add a prefix, or resolving a preset name directly:

```typescript
import { consoleLogger, resolveLogger, type SodaxLogger } from '@sodax/sdk';

const prefixed: SodaxLogger = {
  debug: (m, d) => consoleLogger.debug(`[sodax] ${m}`, d),
  info: (m, d) => consoleLogger.info(`[sodax] ${m}`, d),
  warn: (m, d) => consoleLogger.warn(`[sodax] ${m}`, d),
  error: (m, e, d) => consoleLogger.error(`[sodax] ${m}`, e, d),
};

const resolved = resolveLogger('silent'); // → silentLogger
```

## Example: Sentry in the browser

```typescript
import * as Sentry from '@sentry/react';
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

## Example: structured JSON on a backend

Newline-delimited JSON on stdout is the wire shape Pino, Winston and the Datadog and CloudWatch
agents consume, so this adapter needs no dependencies:

```typescript
import { Sodax, type SodaxLogger } from '@sodax/sdk';

const bigintReplacer = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v);

const serializeError = (error: unknown): unknown =>
  error instanceof Error && !('toJSON' in error)
    ? { name: error.name, message: error.message, stack: error.stack }
    : error; // SodaxError carries toJSON(), which JSON.stringify invokes

const write = (level: string, message: string, data?: Record<string, unknown>, error?: unknown): void => {
  const line = { level, message, ...(data ?? {}), ...(error !== undefined ? { err: serializeError(error) } : {}) };
  process.stdout.write(`${JSON.stringify(line, bigintReplacer)}\n`);
};

const ndjsonLogger: SodaxLogger = {
  debug: (message, data) => write('debug', message, data),
  info: (message, data) => write('info', message, data),
  warn: (message, data) => write('warn', message, data),
  error: (message, error, data) => write('error', message, data, error),
};

const sodax = new Sodax({ logger: ndjsonLogger });
```

A runnable version lives at
[`apps/node/src/logging.ts`](https://github.com/icon-project/sodax-sdks/blob/main/apps/node/src/logging.ts)
(`pnpm --filter node logging`). It requires no private key, RPC or network access: the backend base
URL points at a closed local port, so a real internal SDK failure reaches the sink immediately.

```
{"level":"info","message":"logger wired","custom":true}
{"level":"info","message":"starting backend read","endpoint":"getChains"}
{"level":"error","message":"[BackendApiService] Request error","err":{"name":"TypeError","message":"fetch failed",…}}
{"level":"warn","message":"backend read failed as expected","reason":"SodaxError: fetch failed"}
```

## Example: HTTP intake without a vendor SDK

The demo app ships two adapters at
[`apps/demo/src/lib/loggers`](https://github.com/icon-project/sodax-sdks/tree/main/apps/demo/src/lib/loggers):
`createDatadogLogger()` uses the plain HTTP logs intake with no Datadog SDK and no agent, and
`createSentryLogger()` uses a lazily imported `@sentry/react` behind a tunnel.

`datadogLogger.ts` shows the three constraints a transport-backed adapter has to satisfy:

1. **Coerce `bigint` before serializing.** SDK `data` records carry `bigint` token amounts and chain
   IDs. Without a replacer `JSON.stringify` throws a `TypeError`, and a log call must never throw.

   ```typescript
   const bigintReplacer = (_key: string, value: unknown): unknown =>
     typeof value === 'bigint' ? value.toString() : value;
   ```

2. **Serialize the thrown value explicitly.** Prefer `toJSON()` so a `SodaxError` keeps its
   `feature`, `code` and `context`, and fall back to `{ name, message, stack }` for a plain `Error`.

3. **Send fire-and-forget.** Never `await` the transport inside a log call, and swallow its
   failures — an unreachable intake should drop the line rather than surface as an SDK error.

   ```typescript
   void fetch(intakeUrl, { method: 'POST', body, keepalive: true }).catch(() => {});
   ```

The demo exercises these locally without DNS or a vendor account: a zero-dependency mock intake
(`pnpm mock-intake`, port 9009) sits behind the Vite dev server's same-origin `/__intake/*` proxy, so
there is no CORS preflight and no DNS lookup.

## Coverage

These route through the configured logger:

- `SwapService` and `SolverApiService`
- `BridgeService`, `LeverageYieldService`, `PartnerFeeClaimService`, `SponsoringService`
- `MoneyMarketDataService` and `ConcentratedLiquidityService`
- `BackendApiService`, `SwapsApiService` and the shared request helper
- `SpokeService`, `StellarSpokeService`, `BitcoinSpokeService` and the spoke balance helpers

Staking, migration, recovery and the DEX `AssetService` emit nothing today. Some pure utility and
static-helper functions — `shared/utils/*`, `entities/btc/RadfiProvider`, `entities/solana/utils`,
`swap/IntentDataService` — still call `console.*` directly because they hold no instance logger;
threading it through is tracked as follow-up.

## React mutation errors

`@sodax/dapp-kit` re-exports `SodaxLogger` and forwards `SodaxOptions` through `SodaxProvider`, so
everything above applies unchanged. It also has a separate seam for React Query mutation failures:

```tsx
import { createSodaxQueryClient } from '@sodax/dapp-kit';

const queryClient = createSodaxQueryClient({
  onMutationError: error => Sentry.captureException(error),
});
```

`onMutationError` fires for every failed mutation, which is a UI-level concern, while `logger`
carries the SDK's internal diagnostics. The two overlap on one failure class: a backend request error
is logged through the sink inside the SDK, and the hook then rethrows the failed `Result`, so
`onMutationError` sees the same failure again. Send exceptions to your tracker from only one of them.
A single mutation opts out of the global hook with `meta: { silent: true }`.

## See also

- [Configure SDK](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/CONFIGURE_SDK.md) — the full `SodaxOptions` shape.
- `analytics`, the adjacent option on `SodaxOptions`, carries structured product events and is off by
  default, where `logger` carries free-form diagnostics and is on.
