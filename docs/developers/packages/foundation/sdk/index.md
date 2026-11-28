---
title: "@sodax/sdk"
icon: cup-straw
generatedFrom: packages/sdk/README.md
---

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

### Example: accept deposits from any chain

Your app takes one asset on one network. Your users pay with whatever they hold, on any supported network, and sign once. This example takes USDT on Arbitrum and delivers USDC on Base to the address your app credits. Change the two chain keys and token symbols for any other pair.

```bash
npm install @sodax/sdk @sodax/wallet-sdk-core
```

Run it as an ES module (top-level `await`), for example with `npx tsx deposit.ts` in a project that has `"type": "module"`. It reads `EVM_PRIVATE_KEY`, `DEPOSIT_RECIPIENT` and `SODAX_API_KEY` (free from the [dev portal](https://portal.sodax.com)) from the environment.

```typescript
import { Sodax, ChainKeys, type CreateIntentParams, type Hex } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

// Your app takes deposits as USDC on Base. The user pays with what they already hold:
// here USDT on Arbitrum, but any supported token on any supported network works the same way.
const APP_CHAIN = ChainKeys.BASE_MAINNET;
const USER_CHAIN = ChainKeys.ARBITRUM_MAINNET;
const SLIPPAGE_BPS = 100n; // 1%
const BPS = 10_000n;

const privateKey = process.env.EVM_PRIVATE_KEY;
const depositRecipient = process.env.DEPOSIT_RECIPIENT; // the address your app credits on Base
if (!privateKey?.startsWith('0x') || !depositRecipient?.startsWith('0x')) {
  throw new Error('Set EVM_PRIVATE_KEY and DEPOSIT_RECIPIENT (both 0x-prefixed)');
}

const sodax = new Sodax({ apiKey: process.env.SODAX_API_KEY });

// A key here is for a server or a script. In a browser, pass the user's walletClient / publicClient instead.
const wallet = new EvmWalletProvider({ privateKey: privateKey as Hex, chainId: USER_CHAIN });

const inputToken = sodax.config.spokeChainConfig[USER_CHAIN].supportedTokens.USDT.address;
const outputToken = sodax.config.spokeChainConfig[APP_CHAIN].supportedTokens.USDC.address;
const inputAmount = 25_000_000n; // 25 USDT (6 decimals)

// 1. Quote: free, signs nothing.
const quote = await sodax.swaps.getQuote({
  token_src: inputToken,
  token_dst: outputToken,
  token_src_blockchain_id: USER_CHAIN,
  token_dst_blockchain_id: APP_CHAIN,
  amount: inputAmount,
  quote_type: 'exact_input',
});
if (!quote.ok) throw new Error(`Quote failed: ${quote.error.detail.code}`);

const deadline = await sodax.swaps.getSwapDeadline(300n); // valid for 5 minutes
if (!deadline.ok) throw new Error('Could not get a deadline');

// 2. One intent: USDT on Arbitrum in, USDC on Base out, delivered to your app's recipient.
const params: CreateIntentParams<typeof USER_CHAIN> = {
  inputToken,
  outputToken,
  inputAmount,
  minOutputAmount: (quote.value.quoted_amount * (BPS - SLIPPAGE_BPS)) / BPS,
  deadline: deadline.value,
  allowPartialFill: false,
  srcChainKey: USER_CHAIN,
  dstChainKey: APP_CHAIN,
  srcAddress: await wallet.getWalletAddress(),
  dstAddress: depositRecipient,
  data: '0x',
};

// 3. Approve the token if needed, then sign and submit. Solvers fill it; no bridge to run.
const result = await sodax.swaps.swapWithApproval({ params, walletProvider: wallet });
if (!result.ok) throw new Error(`Deposit failed: ${result.error.code}`);

console.log('Intent created on the hub:', result.value.intentDeliveryInfo.dstTxHash);
```

- **`dstAddress` is whoever gets credited.** Use the user's own address on your network, or an address your app controls.
- **`swapWithApproval` handles the token approval.** On wallets that support batched calls it is one signature; otherwise it approves first, then swaps.
- **Wait for settlement before you credit.** Poll `sodax.swaps.getStatus` until it reports solved. The [first swap guide](https://docs.sodax.com/quickstart) shows the polling loop.

The same deposit with the no-code widget, over plain HTTP, or straight into a vault with a delivery hook: [universal deposits guide](https://www.sodax.com/developers/universal-deposits).

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
* Tron ✅ (USDT only)

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
* Tron ✅

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

AI-readable docs for `@sodax/sdk` (and the other `@sodax/*` packages) are shipped via [`@sodax/skills`](https://github.com/gosodax/sodax-sdks/tree/main/packages/skills) — a separate npm package bundling Claude-Code SKILL.md files and a long-form knowledge tree.

**Recommended: [`skills` CLI](https://github.com/vercel-labs/skills)** — from your project root:

```bash
npx skills@latest add gosodax/sodax-sdks/packages/skills
```

**npm + `AGENTS.md` pointer** (fallback for web chats, or when you prefer a devDependency over the CLI):

```bash
pnpm add -D @sodax/skills
```

Then point your agent at `node_modules/@sodax/skills/AGENTS.md`. See [docs/ai-integration-guide.md](https://github.com/gosodax/sodax-sdks/blob/main/docs/ai-integration-guide.md) for all install modes and per-tool wiring.

***

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/gosodax/sodax-sdks/blob/main/CONTRIBUTING.md) for details.

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

* [MIT](https://github.com/gosodax/sodax-sdks/blob/main/LICENSE)

***

## Support

* [GitHub Issues](https://github.com/gosodax/sodax-sdks/issues)
* [Discord Community](https://discord.gg/xM2Nh4S6vN)
