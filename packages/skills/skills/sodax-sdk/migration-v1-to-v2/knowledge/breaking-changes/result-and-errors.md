# Result and error model breaking changes — v1 → v2

The runtime contract of every async method changed. v1 threw on failure; v2 resolves `{ ok: false, error }`. v1 had per-module typed-error unions; v2 has a single canonical `SodaxError<C>` with a closed 13-code vocabulary.

This is the largest behavioral change in v2. A consumer that ignores it will compile against v2 (with help from the type system) but silently swallow failures — a v1-style `try { await sodax.<method>(...) } catch` does **not** catch SDK-level failures, because they don't throw.

Read after [`type-system.md`](type-system.md) and [`architecture.md`](architecture.md).

## Section index

1. [`Result<T>` — the new return contract](#1-resultt--the-new-return-contract)
2. [`SodaxError<C>` — the canonical error class](#2-sodaxerrorc--the-canonical-error-class)
3. [The 13-code vocabulary](#3-the-13-code-vocabulary)
4. [Reference tables — moved](#4-reference-tables--moved) (v1 ↔ v2 code crosswalk and per-method return-shape diffs)
5. [Carve-out: `BalnSwapService` still throws](#5-carve-out-balnswapservice-still-throws)
6. [Migration patterns](#6-migration-patterns)

---

## 1. `Result<T>` — the new return contract

### Shape

`Result<T, E = Error | unknown>` is defined in `@sodax/types` (re-exported from `@sodax/sdk`):

```ts
type Result<T, E = Error | unknown> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

Every async public method on every feature service in v2 returns `Promise<Result<T, SodaxError<C>>>`. There is no `throw` across a service boundary.

### Where it applies

The **complete list** of services whose public methods return `Result<T>`:

- `SwapService` (every async method)
- `MoneyMarketService` (every async method)
- `BridgeService` (every async method)
- `StakingService` (every async method except `StakingLogic.*` static helpers — see § 5)
- `MigrationService` (every async method except `BalnSwapService` lock-management methods — see § 5)
- `DexService` / `ClService` / `AssetService` (every async method)
- `PartnerService`
- `RecoveryService`
- `BackendApiService`
- `SpokeService` (router-level helpers)
- `IConfigApiV1` implementations (every method)

Private helpers may still throw; the outer `try/catch` at each public method's boundary absorbs those and converts them to `{ ok: false, error }`.

### Propagation pattern

The canonical pattern across the SDK:

```ts
// Forward a sub-Result without re-wrapping.
// (TypeScript narrows the error union — narrower codes are structurally
// assignable to wider ones, so this typechecks even if `sub` returns a smaller
// code union than the outer method.)
const sub = await this.subOperation();
if (!sub.ok) return sub;

// Success
return { ok: true, value: /* … */ };

// Outer catch at every public method's boundary
catch (error) {
  if (isMethodError(error)) return { ok: false, error };
  return {
    ok: false,
    error: new SodaxError('EXECUTION_FAILED', '<short message>', {
      feature: 'swap',
      cause: error,
      context: { action: 'createIntent', phase: 'execution' },
    }),
  };
}
```

There is **no** `toResult` / `tryCatch` / `safeCall` helper. Explicit `try/catch` at each method boundary is the deliberate convention.

### Branching

```ts
const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
if (!result.ok) {
  if (isSodaxError(result.error)) {
    if (result.error.code === 'RELAY_TIMEOUT') { /* resume settlement of the original transaction */ }
    if (result.error.code === 'INTENT_CREATION_FAILED') { /* show input error */ }
  }
  return;
}
const { tx, intent, relayData } = result.value;
```

### Migration mechanics

```diff
- try {
-   const result = await sodax.swaps.createIntent({ intentParams, spokeProvider });
-   const [spokeTxHash, intent, relayData] = result;
-   /* … */
- } catch (e) {
-   if (e instanceof IntentError && e.code === 'CREATE_INTENT_FAILED') { /* … */ }
- }

+ const result = await sodax.swaps.createIntent({ params, raw: false, walletProvider });
+ if (!result.ok) {
+   if (isSodaxError(result.error) && result.error.code === 'INTENT_CREATION_FAILED') { /* … */ }
+   return;
+ }
+ const { tx: spokeTxHash, intent, relayData } = result.value;  // object, not tuple — see ../reference/return-shapes.md
```

### Pitfall

A `try { await sodax.<method>(...) } catch` block in v2 only catches **exceptions** thrown from inside the call (e.g. a bug, a missing argument, a synchronous validation thrown from the wrapper). It does **not** catch SDK-level failures like `RELAY_TIMEOUT` — those resolve to `{ ok: false, error }` and skip your `catch` entirely. The legacy `try/catch` can stay as defense-in-depth, but you **must** also branch on `result.ok`.

---

## 2. `SodaxError<C>` — the canonical error class

### Shape

```ts
class SodaxError<C extends SodaxErrorCode = SodaxErrorCode> extends Error {
  readonly code: C;                 // closed 13-code reason union
  readonly feature: SodaxFeature;   // 'swap' | 'moneyMarket' | 'bridge' | 'staking' | 'migration' | 'dex' | 'partner' | 'recovery' | 'backend' | 'leverageYield'
  readonly cause?: unknown;
  readonly context?: SodaxErrorContext;

  toJSON(): SodaxErrorJSON<C>;      // canonical logger surface (Sentry/Pino/Datadog)
}
```

### Discrimination contract

The `(feature, code)` pair is the canonical discriminator. Loggers emit it as a tag pair; consumer switch statements branch on it. **Do not** string-match on `error.message` — messages are short prose and may change between releases. Codes are closed and stable.

### `isSodaxError` over `instanceof`

```ts
import { isSodaxError } from '@sodax/sdk';

if (isSodaxError(e)) {
  // e: SodaxError<SodaxErrorCode>
}
```

`isSodaxError` walks `e.name === 'SodaxError'` + a `code: string` + `feature: string` shape check. Prefer it over bare `instanceof SodaxError` — `instanceof` returns `false` when `@sodax/sdk` is loaded twice in the same bundle (a real-world hazard with monorepos and dual ESM/CJS, especially in apps with mixed package resolution).

### `error.context`

A free-form metadata bag with reserved fields:

```ts
type SodaxErrorContext = {
  action?: string;            // feature operation (e.g. 'supply', 'stake', 'migrateBaln')
  phase?: SodaxPhase;         // 'validate' | 'intentCreation' | 'verify' | 'submit' | 'relay' | 'destinationExecution' | 'execution' | 'postExecution' | 'approve' | 'allowanceCheck' | 'gasEstimation' | 'lookup'
  srcChainKey?: string;
  dstChainKey?: string;
  relayCode?: 'SUBMIT_TX_FAILED' | 'RELAY_TIMEOUT' | 'RELAY_POLLING_FAILED' | 'UNKNOWN';
  api?: 'solver' | 'backend';
  method?: string;            // names the read-only method on LOOKUP_FAILED
  direction?: 'forward' | 'reverse';  // migration's bnUSD-only
  field?: string;             // VALIDATION_FAILED specifics
  reason?: string;
  [key: string]: unknown;     // open at the index signature
};
```

### `error.toJSON()` for logging

`JSON.stringify(error)` invokes `toJSON()` automatically. The serializer:

- Coerces `bigint` to string anywhere in `context`.
- Walks `cause` chains up to depth 3.
- Stringifies `Date`, `Map`, `Set`, `Error`, and class instances safely.
- Handles cycles (depth-bounded at 5).

Consumer-side logging integration:

```ts
// Sentry
Sentry.captureException(error, { tags: { feature: error.feature, code: error.code, action: error.context?.action } });

// Pino / Winston
logger.error({ err: error }, 'sodax operation failed');
```

---

## 3. The 13-code vocabulary

| Code | Meaning | Common context fields |
|---|---|---|
| `VALIDATION_FAILED` | Pre-flight invariant tripped (input shape, unsupported chain, etc.). | `field`, `reason`, `phase: 'validate'` |
| `INTENT_CREATION_FAILED` | Building the intent / payload failed. | `phase: 'intentCreation'` |
| `EXECUTION_FAILED` | Orchestrator-level catch-all (post-relay business logic). | `action`, `phase: 'execution'` or `'postExecution'` |
| `TX_VERIFICATION_FAILED` | Spoke-side `verifyTxHash` returned false / threw. | `phase: 'verify'`, `srcChainKey` |
| `TX_SUBMIT_FAILED` | Spoke tx landed; relay POST submit failed. | `phase: 'submit'`, `relayCode: 'SUBMIT_TX_FAILED'` |
| `RELAY_TIMEOUT` | Destination packet didn't reach `executed` within timeout. | `phase: 'relay'`, `srcChainKey`, `dstChainKey`, `relayCode: 'RELAY_TIMEOUT'` |
| `RELAY_FAILED` | Relay polling outage / unrecognised relay error. | `phase: 'relay'`, `relayCode` |
| `APPROVE_FAILED` | Token approval call failed. | `phase: 'approve'` |
| `ALLOWANCE_CHECK_FAILED` | Reading on-chain allowance failed. (Distinct from `LOOKUP_FAILED` for retry semantics.) | `phase: 'allowanceCheck'` |
| `GAS_ESTIMATION_FAILED` | Gas estimation returned an error. (Distinct for retry semantics.) | `phase: 'gasEstimation'` |
| `LOOKUP_FAILED` | Read-only on-chain query / off-chain config fetch. | `method`, `phase: 'lookup'` |
| `EXTERNAL_API_ERROR` | Upstream API call failed (solver, backend). | `api: 'solver' \| 'backend'`, plus `solverCode`/`solverDetail` for solver |
| `UNKNOWN` | Last-resort catch in an outer `try`. Should be rare in production. | (none guaranteed) |

### Per-method narrow unions

Every public method declares a `<MethodName>ErrorCode` narrow union built via `Extract<SodaxErrorCode, ...>`. Switch exhaustively over the narrow union when you know the method:

```ts
type CreateSupplyIntentErrorCode = Extract<
  SodaxErrorCode,
  'USER_REJECTED' | 'VALIDATION_FAILED' | 'INTENT_CREATION_FAILED' | 'UNKNOWN'
>;

// In the queryFn or call site:
const result = await sodax.moneyMarket.createSupplyIntent({ params, raw: true });
if (!result.ok) {
  switch (result.error.code) {
    case 'VALIDATION_FAILED':      /* show input error */ break;
    case 'INTENT_CREATION_FAILED': /* show "couldn't build supply intent" */ break;
    case 'UNKNOWN':                /* fallback */ break;
  }
}
```

The narrow unions are exported from each feature's `errors.ts` (e.g. `@sodax/sdk` re-exports `SupplyErrorCode`, `BorrowErrorCode`, `BridgeErrorCode`, `StakeErrorCode`, etc.). See [`reference/`](../../../integration/knowledge/reference/) § "Error codes" for the full catalogue.

### Read-method partition

`LOOKUP_FAILED` is the catch-all for read-only methods. Its partition lives on `error.context.method`:

```ts
if (result.error.code === 'LOOKUP_FAILED') {
  switch (result.error.context?.method) {
    case 'getStakingInfo': /* … */ break;
    case 'getBridgeableAmount': /* … */ break;
    case 'getUnstakingInfoWithPenalty': /* … */ break;
  }
}
```

This avoids inflating the global code count (`getStakingInfoFailed`, `getBridgeableAmountFailed`, …) while keeping per-method retry semantics inspectable.

---

## 4. Reference tables — moved

The two reference-grade tables that used to live in this file (the **v1 ↔ v2 code crosswalk** and the **per-method return-shape diffs**) have moved into `../reference/`:

- [`../reference/error-code-crosswalk.md`](../reference/error-code-crosswalk.md) — every v1 module-error code → v2 `(feature, code, context)` mapping, per feature.
- [`../reference/return-shapes.md`](../reference/return-shapes.md) — per-method return-shape diffs (`CreateIntentResult` tuple → object, every cross-chain mutation now returns `TxHashPair`, `getBridgeableAmount` returns `BridgeLimit`, `getStakeRatio` returns a tuple, etc.).

The prose on shape semantics stays here; the lookup tables live in `../reference/`.

## 5. Carve-out: `BalnSwapService` still throws

The lock-management methods on `BalnSwapService` (a sub-service of `MigrationService`) **do not** return `Result<T>` in v2. They keep the v1 throw-on-error contract:

- `BalnSwapService.claim()`
- `BalnSwapService.claimUnstaked()`
- `BalnSwapService.stake()`
- `BalnSwapService.unstake()`
- `BalnSwapService.cancelUnstake()`
- `BalnSwapService.getDetailedUserLocks()`

This is **technical debt**, marked for cleanup in a future release. Until then, your code must `try/catch` these specific calls. Every other public async method on every other service in v2 returns `Result<T>`.

---

## 6. Migration patterns

### Convert one call site (the typical pattern)

```diff
  try {
-   const result = await sodax.moneyMarket.supply({ params: supplyParams, spokeProvider });
-   const txHash = result;
+   const result = await sodax.moneyMarket.supply({ params: supplyParams, raw: false, walletProvider });
+   if (!result.ok) {
+     setError(getMmErrorText(result.error));
+     return;
+   }
+   const { srcChainTxHash } = result.value;
+   /* … */
  } catch (e) {
    /* keep as defense-in-depth net for unexpected throws */
  }
```

### Adapt a `getXxxErrorText` helper

If your v1 code has a helper that branches on `error.code`, the minimal change is to map v2 shape onto the v1 shape at the boundary:

```ts
// Module-scope helper
function adaptToV1Shape(error: unknown): { code?: string; message?: string; data?: { error?: unknown } } | null {
  if (!error) return null;
  if (isSodaxError(error)) {
    return {
      code: error.code,
      message: error.message,
      data: { error: error.cause },
    };
  }
  if (error instanceof Error) return { code: error.message, message: error.message };
  if (typeof error === 'object') return error as { code?: string; message?: string; data?: { error?: unknown } };
  return null;
}

// Existing branches (sdkError.code === 'SUPPLY_FAILED') keep working — until you migrate
// them properly to (feature, code) tuples per ../reference/error-code-crosswalk.md.
```

### Use the per-feature guard factory for routing

```ts
const isSwapError = isFeatureError('swap');
const isMmError = isFeatureError('moneyMarket');
const isBridgeError = isFeatureError('bridge');

if (!result.ok) {
  if (isSwapError(result.error)) router.push('/swap-error');
  else if (isMmError(result.error)) router.push('/loan-error');
  else if (isBridgeError(result.error)) router.push('/bridge-error');
  else router.push('/error');
}
```

### A `throwIfError` shim for incremental migration

If you can't refactor every call site in one pass:

```ts
// Drop into a shared lib
export function throwIfError<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

// Use at call sites where you haven't migrated the surrounding error handling yet:
const { tx, intent } = throwIfError(
  await sodax.swaps.createIntent({ params, raw: false, walletProvider }),
);
```

This is **transitional**. Once your error-handling tree is updated, remove `throwIfError` and branch on `result.ok` directly. See [`../recipes.md`](../recipes.md) § "Result adapter" for a fuller version.

---

## Cross-references

- Type-level renames (deleted error types, return-type renames): [`type-system.md`](type-system.md) §§ 6, 10.
- Architecture reshape (relay layer, mapRelayFailure, sodaxInvariant, isSodaxError): [`architecture.md`](architecture.md) §§ 3, 4.
- v2 design context (Result propagation, error model): [`architecture.md`](../../../integration/knowledge/architecture.md) and [`recipes/`](../../../integration/knowledge/recipes/) § "Result handling".
- Per-feature narrow code unions: [`reference/`](../../../integration/knowledge/reference/) § "Error codes".
- Per-feature playbooks (with `getXxxErrorText` adapters in context): [`../features/`](../features/).
