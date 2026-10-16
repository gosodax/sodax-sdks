# @sodax/sdk

## Get started

### Installation

```bash
# Using npm
npm install @sodax/sdk

# Using yarn
yarn add @sodax/sdk

# Using pnpm
pnpm add @sodax/sdk
```

### Local Installation

Package can be locally installed by following this steps:

1. Clone this repository to your local machine.
2. `cd` into repository folder location.
3. Execute `pnpm install` command in your CLI to install dependencies.
4. Execute `pnpm run build` to build the packages.
5. In your app repository `package.json` file, define dependency named `"@sodax/sdk"` under `"dependencies"`. Instead of version define absolute path to your SDK repository `"file:<sdk-repository-path>"` (e.g. `"file:/Users/dev/.../operation-liquidity-layer/packages/sdk"`). Full example: `"@sodax/sdk": "file:/Users/dev/operation-liquidity-layer/sdk-new/packages/sdk"`.

### Local Development

How to setup local development

1. Clone repository.
2. Make sure you have [Node.js](https://nodejs.org/en/download/package-manager) v18+ and corresponding npm installed on your system.
3. Execute `pnpm install` command (from root of the project) in your CLI to install dependencies.
4. Make code changes.
   1. Do not forget to export TS files in same folder `index.ts`.
   2. Always import files using `.js` postfix.

### Functional Modules inside the SDK

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/swaps" class="button secondary" data-icon="rotate">Swaps (Solver)</a> -  Cross-chain intent-based swaps

* EVM (Sonic, Ethereum, Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood) ✅
* Sui ✅
* Stellar ✅
* ICON ✅
* Solana ✅
* Injective ✅
* NEAR ✅
* Stacks ✅
* Bitcoin ✅

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/money_market" class="button secondary" data-icon="sack-dollar">Lend / Borrow (Money Market)</a>- Cross-chain lending and borrowing

* EVM (Sonic, Ethereum, Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood) ✅
* Sui ✅
* Stellar ✅
* ICON ✅ (bnUSD only)
* Solana ✅
* Injective ✅
* NEAR ✅
* Stacks ✅
* Bitcoin ✅ (BTC only)

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/bridge" class="button secondary" data-icon="bridge-suspension">Bridge</a>- Cross-chain token bridging

* EVM (Sonic, Ethereum, Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood) ✅
* Sui ✅
* Stellar ✅
* ICON ✅
* Solana ✅
* Injective ✅
* NEAR ✅
* Stacks ✅
* Bitcoin ✅

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/migration" class="button secondary" data-icon="truck">Migration</a>- Token migration (ICX, bnUSD, BALN)

* ICX / wICX → SODA: source chain ICON only
* BALN → SODA: source chain ICON only
* bnUSD: between legacy chains (ICON, Sui, Stellar) and the new bnUSD on any other supported chain

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/leverage_yield" class="button secondary" data-icon="chart-line">Leverage Yield</a>- Leveraged-yield vaults on the Sonic hub

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/leverage_yield_apr" class="button secondary" data-icon="percent">Leverage Yield APR</a>- Steady-state APR for those vaults

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/staking" class="button secondary" data-icon="seedling">Staking</a>- SODA token staking

* EVM (Sonic, Ethereum, Arbitrum, Avalanche, Base, BSC, Optimism, Polygon, HyperEVM, Lightlink, Redbelly, Kaia, Hedera, Robinhood) ✅
* Sui ✅
* Stellar ✅
* Solana ✅
* Injective ✅
* NEAR ✅
* Stacks ✅

### Tooling Modules inside the SDK

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/tooling-modules/backend_api" class="button secondary" data-icon="plug">Backend API</a>- SODAX backend data and submit-tx endpoints

<a href="https://docs.sodax.com/developers/packages/foundation/sdk/tooling-modules/intent_relay_api" class="button secondary" data-icon="envelope">Intent Relay API</a>- Relayer API endpoint documentation

<a href="https://docs.sodax.com/developers/packages/foundation/swaps-api" class="button secondary" data-icon="code">Swaps API</a>- Standalone `@sodax/swaps-api` HTTP client

## AI agent docs

AI-readable docs for `@sodax/sdk` (and the other `@sodax/*` packages) are shipped via [`@sodax/skills`](https://github.com/icon-project/sodax-sdks/tree/main/packages/skills) — a separate npm package bundling Claude-Code SKILL.md files and a long-form knowledge tree.

**Recommended: [`skills` CLI](https://github.com/vercel-labs/skills)** — from your project root:

```bash
npx skills@latest add icon-project/sodax-sdks/packages/skills
```

**npm + `AGENTS.md` pointer** (fallback for web chats, or when you prefer a devDependency over the CLI):

```bash
pnpm add -D @sodax/skills
```

Then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See [docs/ai-integration-guide.md](https://github.com/icon-project/sodax-sdks/blob/main/docs/ai-integration-guide.md) for all install modes and per-tool wiring.

***

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/icon-project/sodax-sdks/blob/main/CONTRIBUTING.md) for details.

***

## Development Commands

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run in development mode
pnpm dev

# Run type checking
pnpm checkTs

# Format code
pnpm pretty

# Lint code
pnpm lint
```

***

## License

* [MIT](https://github.com/icon-project/sodax-sdks/blob/main/LICENSE)

***

## Support

* [GitHub Issues](https://github.com/icon-project/sodax-sdks/issues)
* [Discord Community](https://discord.gg/xM2Nh4S6vN)
