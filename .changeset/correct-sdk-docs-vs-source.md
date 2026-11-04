---
"@sodax/sdk": patch
"@sodax/types": patch
"@sodax/dapp-kit": patch
"@sodax/wallet-sdk-react": patch
"@sodax/swaps-api": patch
---

Correct SDK documentation that had drifted from source.

Documentation only, and no change to which pages publish to docs.sodax.com. The one drift that turned out to be a code defect rather than a doc error is fixed separately.

Corrections verified against current `src`: `DEX.md` documented `AssetServiceError`, `ConcentratedLiquidityError` and `GET_POOL_DATA_FAILED`, none of which exist — it now describes the real mixed contract (typed `SodaxError` everywhere except the relay leg, which DEX alone does not route through `mapRelayFailure`). The architecture reference still taught `new Error('PHASE_FAILED')` and message comparison, superseded by `SodaxError<C>` and the `src/errors/wrappers.ts` phase wrappers. `@sodax/types` listed `IConfigApi` and `SubmitSwapTxRequest/Response/StatusResponse` as backend contracts; the real exports are the `V1`/`V2` names. Relayer docs carried `HTTP_REQUEST_FAILED`, which belongs to the backend HTTP layer, not the relay contract (`SUBMIT_TX_FAILED`, `RELAY_TIMEOUT`, `RELAY_POLLING_FAILED`).

Also fixed: the non-existent `testnet` prop on `SodaxProvider`, `CreateIntentError` → `SwapCreateIntentError`, the `createIntent` phase tag, `estimateGas` taking `.value` instead of `.value.tx`, `getQuote`'s partner-fee override being a payload field rather than a second argument, the missing `analytics` option, the two leverage-yield vaults absent from the APR table, the NEAR storage hooks missing from `@sodax/dapp-kit`, `userDisconnected` missing from the persisted store, Solana and Sui `signMessage` return types, and `@sodax/swaps-api` telling users to install `valibot` separately when it is a regular dependency.

Adds `packages/sdk/docs/RECOVERY.md`, written from source for `sodax.recovery`, which shipped with no prose. It is parked on the `unpublished` list in `scripts/docs-pages-map.json`: publishing it, and the twelve `@sodax/wallet-sdk-react` guides the package README still links to raw GitHub, is a separate navigation change.
