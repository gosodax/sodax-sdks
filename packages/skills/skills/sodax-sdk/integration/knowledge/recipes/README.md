# Recipes — `@sodax/sdk` v2

Copy-pasteable patterns for the most common Core SDK consumer tasks. Each file is self-contained — drop the snippet into your code, swap in your specifics, done.

| Recipe | When |
|---|---|
| [`initialize-sodax.md`](initialize-sodax.md) | App startup. `new Sodax()` + `await sodax.config.initialize()`, with and without config override. |
| [`result-and-errors.md`](result-and-errors.md) | Branching on `result.ok`, switching on `(error.feature, error.code)`, `isSodaxError` over `instanceof`, sub-Result propagation, logger integration. |
| [`logging.md`](logging.md) | Select a `SodaxLogger` (`'console'` / `'silent'` / custom sink) at construction; forward SDK diagnostics to Sentry / Pino / Datadog. |
| [`signed-tx-flow.md`](signed-tx-flow.md) | `raw: false` + chain-narrowed `walletProvider`. Returns tx hash (or `TxHashPair` for cross-chain mutations). |
| [`raw-tx-flow.md`](raw-tx-flow.md) | `raw: true`. Builds an unsigned chain-specific payload; you sign elsewhere. |
| [`chain-key-narrowing.md`](chain-key-narrowing.md) | Cast-at-boundary pattern; runtime `chainType` discriminant. |
| [`testing.md`](testing.md) | Mocking the `Sodax` instance, stubbing the relay layer, `Result<T>` assertions. |
| [`gas-estimation.md`](gas-estimation.md) | Pre-flight gas estimation for raw-tx flows. |
| [`backend-server-init.md`](backend-server-init.md) | Node script / bot / partner backend pattern with `declare const` wallet placeholders. |
| [`manual-submit-tx-with-fallback.md`](manual-submit-tx-with-fallback.md) | Driving the swap steps yourself instead of `swap()`: backend submit-tx + status poll, with the client-side relay fallback `swap()` does internally. |

## Cross-references

- v2 architectural concepts: [`../architecture.md`](../architecture.md).
- Lookup tables (chain keys, error codes, public API): [`../reference/`](../reference/).
- DO / DO NOT / workflow: [`../ai-rules.md`](../ai-rules.md).
- v1 → v2 migration: [`recipes.md`](../../../migration-v1-to-v2/knowledge/recipes.md).
