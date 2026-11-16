# Reference — `@sodax/sdk` v2

Lookup tables and inventories. Each file is focused on one domain — token-cheap retrieval.

| File | Contents |
|---|---|
| [`chain-keys.md`](chain-keys.md) | `ChainKeys.*` values × chain family × address-type mapping. Chain-family helper functions. Type aliases (`ChainKey`, `SpokeChainKey`, `EvmChainKey`, `HubChainKey`). |
| [`wallet-providers.md`](wallet-providers.md) | `I*WalletProvider` interfaces per chain family. `chainType` discriminant. `GetWalletProviderType<K>`. `IWalletProvider` broad union. Implementation source (consumer's own, or `@sodax/wallet-sdk-core` separate package). |
| [`error-codes.md`](error-codes.md) | The 13 unified `SodaxErrorCode` values + meanings + retry guidance + common context fields. The 9 `SodaxFeature` tags (8 domain + `'backend'` for the HTTP-client layer). The `SodaxPhase` orchestration tags. Per-method narrow code unions for every public method on every service. |
| [`public-api.md`](public-api.md) | What `@sodax/sdk` barrel exports. Import-rule contract (root-only, no deep imports, types re-exported from `@sodax/types`). |
| [`glossary.md`](glossary.md) | Domain terms (hub, spoke, intent, relay, vault, hub-wallet abstraction, etc.) used throughout the docs. |

## Cross-references

- v2 architectural concepts (the prose behind these tables): [`../architecture.md`](../architecture.md).
- Recipes that use these lookups: [`../recipes/`](../recipes/).
- DO / DO NOT / workflow: [`../ai-rules.md`](../ai-rules.md).
- v1 → v2 migration: [`sodax-sdk` (migration mode)](../../../migration-v1-to-v2/knowledge/).
