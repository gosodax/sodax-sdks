# Integration — `@sodax/sdk` v2

This tree documents v2 of the SDK for **new consumers** building against it. If you're porting v1 code, start at [`README.md`](../../migration-v1-to-v2/knowledge/README.md) instead.

## Files in this tree

| File | What's in it |
|---|---|
| [`quickstart.md`](quickstart.md) | Install, initialize a `Sodax` instance, and the top init/setup errors and how to fix them. Covers reads (no wallet), raw-tx flows (no wallet), and signed flows (consumer-supplied wallet provider). |
| [`architecture.md`](architecture.md) | Every v2 design concept the SDK rests on, in a single TOC-navigable file: hub-and-spoke model, `SpokeService` router, `Sodax` facade + `ConfigService`, `ChainKeys`, `WalletProviderSlot<K, Raw>`, `Result<T>`, `SodaxError<C>` + 13-code vocabulary, relay layer (`mapRelayFailure`, `relayTxAndWaitPacket`). |
| [`features/swap.md`](features/swap.md) | `SwapService`: intent-based swaps via the solver — `createIntent`, `swap`, `postExecution`, limit orders, `cancelIntent`. |
| [`features/money-market.md`](features/money-market.md) | `MoneyMarketService`: cross-chain lending/borrowing — supply, borrow, withdraw, repay, reserves, allowance. |
| [`features/staking.md`](features/staking.md) | `StakingService`: SODA → xSoda — stake, unstake, instant unstake, claim, cancel; ratio + info reads. |
| [`features/bridge.md`](features/bridge.md) | `BridgeService`: cross-chain token transfer via vault — `bridge`, `createBridgeIntent`, `getBridgeableAmount`, `getBridgeableTokens`. |
| [`features/dex.md`](features/dex.md) | `ClService` (concentrated liquidity) + `AssetService`: position lifecycle (mint/increase/decrease), claim rewards, asset deposit/withdraw. |
| [`features/migration.md`](features/migration.md) | `MigrationService` (the SDK module): ICX, bnUSD, BALN sub-services + lock management. |
| [`features/partner.md`](features/partner.md) | `PartnerService` — partner-fee handling. |
| [`features/recovery.md`](features/recovery.md) | `RecoveryService` — withdraw stuck hub-wallet assets. |
| [`features/backend-api.md`](features/backend-api.md) | `BackendApiService` — HTTP client for backend reads + swap-tx submission. |
| [`features/sponsoring.md`](features/sponsoring.md) | `SponsoringService` — Stellar account activation via sponsored reserves. |
| [`recipes/`](recipes/) | Copy-pasteable patterns: SDK initialization, `Result` + error discrimination, raw-tx flow, signed-tx flow, chain-key narrowing + cast-at-boundary, testing (mocks/stubs), gas estimation, backend-server init. |
| [`reference/`](reference/) | Lookup tables: `ChainKeys` table with family + address type, `I*WalletProvider` interfaces, 13 `SodaxErrorCode` meanings + per-feature narrow unions, public API surface (incl. `@sodax/types` re-export rule), glossary. |
| [`chain-specifics.md`](chain-specifics.md) | Non-EVM quirks — Stellar trustline check/request, Bitcoin PSBT + Bound Exchange auth/session, Solana PDA derivation, ICON Hana wallet + chain-key string, NEAR connector discovery, Tron MPC-relay settlement. |

## Reading order for a new integrator

1. `quickstart.md` — get the SDK installed and a `Sodax` instance running.
2. `architecture.md` — understand the type system (`ChainKeys`, `Result`, `WalletProviderSlot`, `SodaxError`) before writing call sites.
3. `recipes/` — pick the patterns you need (signed vs raw, error handling, narrowing).
4. `features/<x>.md` — read the file for the feature you're integrating.
5. `chain-specifics.md` — only if you target a non-EVM chain; skip otherwise.
6. `reference/` — keep open while writing for table lookups.

## Cross-references to migration

If your project also has v1 call sites, port them first using:

- [`README.md`](../../migration-v1-to-v2/knowledge/README.md) — overview, reading order, and cross-cutting checklist.
- [`breaking-changes/type-system.md`](../../migration-v1-to-v2/knowledge/breaking-changes/type-system.md) — type renames and shape changes you'll hit on import.
- [`breaking-changes/architecture.md`](../../migration-v1-to-v2/knowledge/breaking-changes/architecture.md) — `*SpokeProvider` deletion, `ConfigService` replacing static lookups, relay flow reshape.
- [`breaking-changes/result-and-errors.md`](../../migration-v1-to-v2/knowledge/breaking-changes/result-and-errors.md) — throws → `Result<T>` and module errors → `SodaxError<C>`, with the v1↔v2 code crosswalk.
- [`features/`](../../migration-v1-to-v2/knowledge/features/) — per-feature playbooks in lockstep with the integration features here.

The naming rule: **every feature in `integration/features/` has a sibling in `migration/features/` with the same filename.** When you're deep in one, the other is one path-swap away.
