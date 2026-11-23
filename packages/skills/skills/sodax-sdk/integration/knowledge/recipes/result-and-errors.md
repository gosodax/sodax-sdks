# Result handling and error discrimination

Every async public method on every feature service returns `Promise<Result<T, SodaxError<C>>>`.

### Branching pattern

```ts
import { isSodaxError } from '@sodax/sdk';

const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });

if (!result.ok) {
  // Always isSodaxError-narrow before reading .feature / .code
  if (isSodaxError(result.error)) {
    if (result.error.code === 'RELAY_TIMEOUT') {
      // Resume settlement of the original transaction; do not repeat the call.
    } else if (result.error.feature === 'swap' && result.error.code === 'INTENT_CREATION_FAILED') {
      // input-error UX
    } else if (result.error.code === 'EXTERNAL_API_ERROR' && result.error.context?.api === 'solver') {
      // solver-side problem; surface error.context.solverDetail to the user
    }
  }
  return;
}

const { tx, intent, relayData } = result.value;
```

### Switch-style with narrow code unions

When you know the method, the narrow code union from its declaration enables an exhaustive switch:

```ts
type CreateSupplyIntentErrorCode = 'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN';

const result = await sodax.moneyMarket.createSupplyIntent({ params, raw: true });
if (!result.ok) {
  switch (result.error.code as CreateSupplyIntentErrorCode) {
    case 'VALIDATION_FAILED':      return setError('Invalid input');
    case 'INTENT_CREATION_FAILED': return setError('Could not build supply');
    case 'UNKNOWN':                return setError('Unexpected error');
  }
}
```

### Per-feature guard factory

```ts
import { isFeatureError } from '@sodax/sdk';

const isSwapError = isFeatureError('swap');
const isMmError = isFeatureError('moneyMarket');

if (!result.ok) {
  if (isSwapError(result.error)) /* … */;
  else if (isMmError(result.error)) /* … */;
}
```

### Sub-Result propagation

For wrapper methods you write yourself:

```ts
async function myWorkflow(): Promise<Result<MyOutput, SodaxError>> {
  const sub = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
  if (!sub.ok) return sub;   // forward as-is

  const { tx, intent } = sub.value;
  return { ok: true, value: { tx, intent, ts: Date.now() } };
}
```

### Logging

```ts
import { isSodaxError } from '@sodax/sdk';

if (!result.ok) {
  if (isSodaxError(result.error)) {
    Sentry.captureException(result.error, {
      tags: {
        feature: result.error.feature,
        code: result.error.code,
        action: result.error.context?.action ?? null,
        relayCode: result.error.context?.relayCode ?? null,
      },
    });
  } else {
    Sentry.captureException(result.error);
  }
}
```

`SodaxError.toJSON()` is invoked automatically by `JSON.stringify(error)` — Pino, Datadog, and Winston pick it up without configuration.

---


## Cross-references

- [`README.md`](README.md) — recipe index.
- [`../architecture.md`](../architecture.md) — concepts behind these patterns.
- [`../reference/`](../reference/) — chain keys, error codes, public API surface.
