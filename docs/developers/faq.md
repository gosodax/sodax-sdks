---
title: "FAQ"
icon: comment-question
---

#### 1. Which chains does SODAX support?

SODAX runs on a hub-and-spoke network of **mainnet** chains. Sonic is the hub; spokes span EVM chains (<span data-sodax-config="chain-names" data-type="EVM" data-exclude="sonic">Arbitrum, Avalanche, Base, BNB Chain, Ethereum, Hedera, Hyper, Kaia, LightLink, Optimism, Polygon, Redbelly, Robinhood Chain</span>) and non-EVM chains (<span data-sodax-config="chain-names" data-type="non-EVM">Bitcoin, ICON, Injective, Near, Solana, Stacks, Stellar, SUI</span>) — both lists read live from the backend config API. Reference any chain via `ChainKeys.*`, which — together with the backend config — is the source of truth. The legacy `*_CHAIN_ID` constants were **removed in v2**; see [Chain ID migration](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/CHAIN_ID_MIGRATION.md) for the mapping.

Full list with relay IDs: [Relayer API endpoints](/developers/deployments/relayer-api-endpoints).

#### 2. Is SODAX available on a testnet?

No — SODAX is **mainnet-only**. Every chain in the canonical `@sodax/types` config is a `*_MAINNET` entry; there are no testnet chain configs, RPC endpoints, or a network toggle, because SODAX's cross-chain intents settle against real deployed contracts and live solver liquidity that only exist on mainnet. To build and test, use small amounts on mainnet and drive flows with the private-key wallet providers (see `apps/node`) rather than a testnet.

Full explanation and next steps: [Is SODAX on Testnet?](/developers/how-to/testnet).

#### 3. What is the difference between the hub and a spoke chain?

Sonic is the hub. All swap, lend, borrow, bridge and stake actions are coordinated by hub contracts (Intents, Asset Manager, Hub Wallet Factory). Spoke chains hold user funds and act as deposit and execution venues. The SODAX relayer carries cross-chain messages between them.

Deep dives: [Technical Overview](/developers/technical-overview), [Asset Manager](/developers/technical-overview/asset-manager), [Generalized Messaging Protocol](/developers/technical-overview/generalized-messaging-protocol).

#### 4. Do I need to call `sodax.initialize()` before using the SDK?

Not strictly. The constructor uses defaults packaged with the SDK version you installed. `await sodax.initialize()` fetches the latest tokens and chains from the backend API. Recommended for production, optional for prototypes. If it fails, the SDK falls back to packaged defaults rather than throwing.

See [Configure SDK](/developers/how-to/configure_sdk).

#### 5. How do I override the hub RPC or contract addresses?

Pass a partial `hub` block to the constructor:

```tsx
new Sodax({ hub: { rpcUrl: 'https://rpc.soniclabs.com' } })
```

Read the merged config from `sodax.instanceConfig.hub`. Note that `sodax.config.getHubChainConfig()` returns the packaged snapshot, not your overrides.

Full config reference: [Configure SDK](/developers/how-to/configure_sdk).

### SDK behaviour

#### 6. Why don't SDK methods throw?

Every public method returns `Result<T, E>` shaped as `{ ok: true, value }` or `{ ok: false, error }`. Do not wrap SDK calls in try/catch. Check `result.ok` first, then discriminate on `result.error.code`.

The pattern is canonical across modules: [Backend API](/developers/packages/foundation/sdk/tooling-modules/backend_api).

#### 7. How should I handle errors properly?

Switch on the narrow `error.code` union (for example `VALIDATION_FAILED`, `RELAY_TIMEOUT`, `TX_SUBMIT_FAILED`). Never branch on `error.message`, it is human-readable and may change. The original lower-level error is preserved on `error.cause`, structured metadata on `error.context`. Use the exported guards (`isSwapError`, `isStakeOrchestrationError`, `isMigrateOrchestrationError`, `isPartnerError`) in dapp code for cross-bundle type safety.

Per-module code tables: [Swaps](/developers/packages/foundation/sdk/functional-modules/swaps), [Money Market](/developers/packages/foundation/sdk/functional-modules/money_market), [Bridge](/developers/packages/foundation/sdk/functional-modules/bridge), [Staking](/developers/packages/foundation/sdk/functional-modules/staking), [Migration](/developers/packages/foundation/sdk/functional-modules/migration).

#### 8. What should I do when a swap returns `RELAY_TIMEOUT`?

The spoke transaction landed but the hub packet has not arrived within the timeout window. The relay may still complete. Persist the spoke tx hash and poll the relayer API. Do not re-submit from the user side.

Error semantics: [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap), [Relayer API endpoints](/developers/deployments/relayer-api-endpoints).

#### 9. What does `TX_SUBMIT_FAILED` mean?

The critical case. The spoke tx landed but the relay submission itself failed. Funds may be in flight. Persist the user's input plus spoke tx hash and retry submission against the relay API. Do not retry the user-facing transaction.

Full code reference: [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap).

### Swaps and intents

#### 10. What is the difference between `swap()`, `createIntent()` and `createLimitOrder()`?

`swap()` coordinates intent creation, relay submission and solver notification (signed execution only). It does **not** approve the input token for you. Before calling it, check `isAllowanceValid()` and call `approve()` when it returns `false`. On EVM chains this is an ERC-20 allowance and on Stellar it is a trustline; other chains return `true` and need no approval. See the [token approval flow](/developers/packages/foundation/sdk/functional-modules/swaps#token-approval-flow) for chain-specific requirements.

A successful submission is not settlement: [poll until settled](/quickstart#poll-until-settled).

`createIntent()` is the lower-level primitive and supports both signed and raw modes (`raw: true` for custom signing flows).

`createLimitOrder()` produces an intent with no deadline. The user must cancel it manually.

Full method list: [Swaps](/developers/packages/foundation/sdk/functional-modules/swaps).

#### 11. How do I get a swap quote and feed it into `minOutputAmount`?

Call `sodax.swaps.getQuote(payload)` with `token_src`, `token_dst`, source and destination `ChainKeys`, an amount in the token's smallest unit, and `quote_type: 'exact_input'`. Use `quoted_amount` from the response to set `minOutputAmount` on the intent.

Walkthrough with code: [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap).

#### 12. Can I cancel an intent?

Yes. Call `cancelIntent(intent)` on the Intents contract. The caller must be the creator, or the deadline must have passed. Intents with pending fills cannot be cancelled. Limit orders (`deadline = 0`) always require manual cancellation.

Contract interface: [Intents](/developers/technical-overview/intents).

#### 13. Are intents trustless? Can a solver run off with funds?

No. Solvers cannot exit with user funds. They lock collateral in the `IntentFiller` contract on the destination spoke when filling. The hub is the source of truth for intent state and settlement, spokes act only as escrow and execution venues. Settlement reconciles cross-chain via the relay.

Detailed flow: [Intents](/developers/technical-overview/intents).

### Lend, borrow, bridge, stake

#### 14. Which actions actually need on-chain approval?

EVM spokes: `supply` and `repay` approve the Asset Manager contract.

Sonic hub: `supply` and `repay` approve the user's hub router.

Stellar: `supply`, `repay`, `withdraw`, `borrow` all check and establish trustlines.

Borrow and withdraw on EVM and hub do not require approval. Most non-EVM chains require no on-chain approval at all.

Full matrix: [Money Market](/developers/packages/foundation/sdk/functional-modules/money_market).

#### 15. How is the bridge different from a swap?

Bridge moves the same asset across chains using the hub vault, with no price discovery. Swap routes through the solver marketplace for cross-network price execution. The bridge supports three directions: spoke to hub, hub to spoke, and spoke to spoke.

See [Bridge](/developers/packages/foundation/sdk/functional-modules/bridge) and [Swaps](/developers/packages/foundation/sdk/functional-modules/swaps).

#### 16. How do I estimate gas across different chain families?

Build a raw tx with `raw: true` from any `createIntent`, `createSupplyIntent`, `approve`, etc. Then call the matching module's `estimateGas({ tx, chainKey })`. The return shape depends on the chain family.

EVM, ICON, Stellar, Bitcoin, NEAR return a `bigint`. Sui returns `{ computationCost, storageCost, storageRebate, nonRefundableStorageFee }`. Injective returns `{ gasWanted, gasUsed }`. Stacks returns `{ low, medium, high }` fee tiers. Solana returns `number | undefined` compute units.

Examples per chain: [Estimate Gas](/developers/how-to/estimate_gas).

#### 17. Can I stake SODA from a non-EVM chain like Sui or Stellar?

Yes. Every `StakingService` method accepts any `SpokeChainKey` as the source. If you pass `ChainKeys.SONIC_MAINNET`, the spoke and hub tx hashes are identical. Approval is required only on EVM spokes, the hub, and Stellar.

See [Staking](/developers/packages/foundation/sdk/functional-modules/staking).

### Monetization, integration, tooling

#### 18. How do partner fees work and how do I claim them?

Set a global default with the top-level `fee`, then override it per feature with `swaps.partnerFee`, `moneyMarket.partnerFee`, `bridge.partnerFee` and `leverageYield.partnerFee` on `SodaxConfig` — vault flows read the `leverageYield` slot, not `swaps`. `getQuote` deducts the swap partner fee from the input amount before forwarding to the solver, so no fee field appears in the request payload. Claim accrued fees via `sodax.partners.feeClaim*` methods, which return `Result<T, PartnerError>`.

Setup and claim flows: [Monetize SDK](/developers/how-to/monetize_sdk).

#### 19. When do I need the `IntentRelayChainId` versus `ChainKeys`?

The relay API identifies chains by a numeric `IntentRelayChainId` (for example `BASE_MAINNET = 30n`, `SOLANA_MAINNET = 1n`, `BITCOIN_MAINNET = 627463n`). The SDK converts internally. You only need `getIntentRelayChainId(chainKey)` when constructing raw relay requests directly, which is advanced usage.

Full mapping: [Relayer API endpoints](/developers/deployments/relayer-api-endpoints).

#### 20. How do I wire SODAX into my AI coding agent (Claude Code, Cursor, Codex)?

From your project root run `npx skills@latest add icon-project/sodax-sdks/packages/skills`. The CLI detects your tool (Claude Code, Cursor, Codex, Copilot) and installs five skill directories, each with its own `SKILL.md`, into the conventional discovery path (e.g. `.claude/skills/sodax-<pkg>/`). The CLI does **not** copy the package-level `AGENTS.md` — agents auto-discover the skills from `SKILL.md` frontmatter, so there is nothing to point your agent rules at. If you install via npm or a `file:` path instead, `node_modules/@sodax/skills/AGENTS.md` is the router.

See [AI Integration](/ai-integration-guide).

#### 21. What is hub wallet abstraction and when do I touch it directly?

The hub generates a deterministic user wallet on Sonic for every spoke address. For spoke chains with limited calldata, the SDK supports hashed calls: send a 32-byte `keccak256` payload to the hub, then execute the stored call later with the same data. The relayer handles this in normal flows. You only touch it directly when building custom orchestration or recovering stuck cross-chain executions.

See [Hub Wallet Abstraction](/developers/technical-overview/hub-wallet-abstraction).

#### 22. Can my AI agent query SODAX docs directly instead of web-searching?

Yes, two ways. This documentation site hosts an auto-generated MCP server at `docs.sodax.com/mcp` that exposes a search tool over these pages — add it to your agent's MCP config, or use the "Add to \[agent]" option in the contextual menu on any page. For more than doc search, add the [Builders MCP](/builders-mcp) (`https://builders.sodax.com/mcp`): 40 tools giving the agent live chains, tokens, quotes, money market rates, intent lookups **and** these docs, over one endpoint.

See [Builders MCP](/builders-mcp) and [AI Integration](/ai-integration-guide).
