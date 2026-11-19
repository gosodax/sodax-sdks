---
title: "Add Robinhood stocks to your app"
sidebarTitle: "Robinhood stocks"
description: "Let your users buy, sell and move Robinhood tokenized stocks and ETFs on Hedera, Stellar and Robinhood Chain: find stock tokens over HTTP, the swap and bridge flow over the HTTP API and the TypeScript SDK, the dapp-kit hooks, how to verify backing on-chain, and the gotchas."
icon: chart-line
---

Use this guide to add Robinhood tokenized stocks to your app with SODAX. Your users can buy a stock with a token they already hold, sell it back, and move it between Hedera, Stellar and Robinhood Chain. The guide covers how the tokens work, the order of the steps and the rules that matter. HTTP is the primary integration path; the TypeScript SDK and React hooks are an alternative. Signatures, types and full working code live in the references it links to, and those are what to copy from.

| Find an answer | Go to |
| --- | --- |
| What the tokens are, and how they are backed | [What it is](#what-it-is) |
| Which tickers and networks are live | [Live tickers and networks](#live-tickers) |
| Which path to use | [Choose a path](#choose-a-path) |
| Buy or sell a stock over HTTP | [Swap: HTTP API](#swap-http) |
| Move a stock between networks over HTTP | [Bridge: HTTP API](#bridge-http) |
| Buy or sell a stock in TypeScript | [Swap: TypeScript (SDK)](#swap-sdk) |
| Move a stock between networks in TypeScript | [Bridge: TypeScript (SDK)](#bridge-sdk) |
| The React flow | [dapp-kit hooks](#dapp-kit-hooks) |
| Check the backing yourself | [Verify backing on-chain](#verify-backing) |
| Why a quote or transfer fails | [Gotchas](#gotchas) |
| Backing, keys, limits and the path back | [FAQ](#faq) |

## What it is {#what-it-is}

Robinhood issues tokenized stocks, ETFs and commodity funds on its own network, Robinhood Chain. Each one is an ordinary token named "Company name - Robinhood Token", for example "Apple - Robinhood Token" (AAPL). SODAX makes the same stocks available on Hedera and Stellar, so your users can hold and trade them without leaving the network they already use.

SODAX uses a hub-and-spoke design. Sonic is the hub, where the core contracts run. Every other network is a spoke that holds assets locally. For background, read [Hub and spoke: how SODAX works](/resources/blog/hub-and-spoke).

Three facts shape the integration:

- **Every Hedera stock token is backed 1:1 by the real Robinhood token.** The real tokens are locked in the SODAX SpokeAssetManager contract on Robinhood Chain. The SpokeAssetManager is the SODAX contract on each spoke that holds deposits and pays out withdrawals.
- **Each ticker is one vault token on Sonic.** A vault token is a single token on the hub that wraps the versions of the same asset from different networks. AAPL on Robinhood Chain, Hedera and Stellar all wrap into the one AAPL vault token, and that shared vault is what lets a stock move between the three networks. See [Vault Token](/developers/technical-overview/vault-token).
- **Stocks are swap assets.** A stock quotes and executes like any other token, through the [Swaps API](/developers/http-api/swaps). Moving the same stock from one network to another uses the [Bridge API](/developers/packages/foundation/bridge-api).

On Hedera, the supply of each stock token is created in advance and held by the SODAX SpokeAssetManager contract (`0x0df73542cC68bDC01b361d231c60F726B0e0bC05`, Hedera account `0.0.10495847`). So the supply in users' hands is the token's total supply minus what that contract still holds. The same contract address holds the locked Robinhood tokens on Robinhood Chain. Hedera stock tokens use Hedera's native token service (HTS) and have no KYC, freeze, wipe or pause keys.

## Live tickers and networks {#live-tickers}

Tickers are added over time, so read the list from the API rather than hard-coding it ([Swap: HTTP API](#swap-http) shows how over HTTP, and [Swap: TypeScript (SDK)](#swap-sdk) shows how in TypeScript). Every live ticker and its addresses are listed in [Mainnet deployments: Robinhood Tokenized Equities](/developers/deployments/mainnet#robinhood-tokenized-equities).

| Network | Role | Token decimals | Where the addresses live |
| --- | --- | --- | --- |
| Robinhood Chain | Where Robinhood issues the real tokens | 18 | `robinhoodSupportedTokens` |
| Hedera | Spoke, HTS tokens | 8 | `hederaSupportedTokens` |
| Stellar | Spoke, Stellar asset contracts | 7 | `stellarSupportedTokens` |
| Sonic | Hub, one vault token per ticker | — | `SodaTokens` |

Read addresses from `GET /v1/swaps/tokens` or `@sodax/sdk` in code rather than copying them from a page. Each ticker is priced by its Robinhood Chain Chainlink feed where one exists, otherwise by Robinhood's own price API.

Some stocks and ETFs are also money-market reserves; [Money Market on Robinhood Chain](/robinhood-chain/money-market) lists them. Users can supply them from Robinhood Chain, Stellar, Hedera or Sonic and borrow other assets against them; borrowing the stocks themselves is disabled. Every other stock is a swap asset only.

## Choose a path {#choose-a-path}

| | Swap | Bridge |
| --- | --- | --- |
| Use when | A user buys a stock with another token, or sells a stock for another token | A user moves the same stock from one network to another, for example Hedera to Robinhood Chain |
| HTTP API | [Swaps API](/developers/http-api/swaps) | [Bridge API](/developers/packages/foundation/bridge-api) — send `x-api-key` from your server; get one at [portal.sodax.com](https://portal.sodax.com) |
| SDK | `sodax.swaps` | `sodax.bridge` |
| React | `useQuote`, `useSwap` and related hooks | `useBridge` and related hooks |
| Who fills it | A solver on the SODAX marketplace | No solver. The hub moves the asset through the shared vault |

## Prerequisites

For HTTP and SDK alike:

- A SODAX API key, kept on your server and sent as `x-api-key` on bridge calls. See [API keys](/developers/how-to/api-keys).
- RPC access to broadcast signed transactions on the source chain. The HTTP API builds the unsigned `tx`; you sign and broadcast it.

For the TypeScript SDK path, additionally:

- The `@sodax/sdk` package installed, plus `@sodax/wallet-sdk-core` (or `@sodax/wallet-sdk-react` in a React app) for wallet providers
- A wallet on the network your user starts from, with enough of the native token to pay network fees (HBAR on Hedera, XLM on Stellar, ETH on Robinhood Chain)
- RPC URLs for the networks you use. The SDK's defaults are in `spokeChainConfig`; a dedicated node provider is better in production

SODAX is mainnet-only, so test with small amounts. See [Is SODAX on Testnet?](/developers/how-to/testnet).

## Swap path: buy or sell a stock {#swap-path}

### HTTP API {#swap-http}

The swap flow over HTTP uses the same endpoints as any other token. For the full endpoint reference see [Swaps API](/developers/http-api/swaps).

#### Find the stock tokens {#find-stocks-http}

`GET /v1/swaps/tokens` returns all supported swap tokens grouped by chain key. Filter on `isRwa: true` to get the tokenized equities. The `isRwa` field is returned by the live API; it is absent from the OpenAPI schema at [api.sodax.com/v1/swaps/docs](https://api.sodax.com/v1/swaps/docs).

```bash
# All stock tokens on Hedera
curl -s 'https://api.sodax.com/v1/swaps/tokens/hedera' \
  | jq '[.[] | select(.isRwa == true) | {symbol, address, decimals, chainKey}]'
```

Use the `address` and `chainKey` values in the quote and intent calls below.

#### Quote, approve, execute and track {#swap-http-steps}

The stock-specific flow is identical to any other token swap; stock tokens use no special endpoints. For the full step-by-step, with request bodies and response shapes, see [Swaps API](/developers/http-api/swaps):

1. **Quote** — `POST /v1/swaps/quote` with the source and destination token addresses and `quoteType: "exact_input"`.
2. **Apply slippage** to `quotedAmount` on the client side. Never pass `0` as `minOutputAmount`.
3. **Check allowance** — `POST /v1/swaps/allowance/check`.
4. **Approve** — `POST /v1/swaps/approve` if allowance is insufficient.
5. **Build the intent tx** — `POST /v1/swaps/intents`. Sign and broadcast the returned `tx` on the source chain.
6. **Submit and track** — `POST /v1/swaps/submit-tx` with the broadcast `txHash`, then poll `GET /v1/swaps/submit-tx/status` until `solved` or `failed`.

### Using TypeScript (SDK) {#swap-sdk}

Set up `Sodax` and a wallet provider first, as in [Configure the SDK](/developers/how-to/configure_sdk) and [Wallet providers](/developers/how-to/wallet_providers). Hedera and Robinhood Chain are EVM networks, so both use `IEvmWalletProvider`. Stellar uses `IStellarWalletProvider`.

A stock swap is the same flow as [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap). Follow that guide for the full detail. The steps are:

1. **Find the stock tokens.** Filter the supported tokens on a network with `isRealWorldAsset` to build a stocks list.
2. **Quote** with `sodax.swaps.getQuote`.
3. **Apply your slippage** to the quoted amount to get `minOutputAmount`. Never send `0n`.
4. **Check and approve** with `sodax.swaps.isAllowanceValid` and `sodax.swaps.approve`. On Stellar this sets up a trustline instead (see [Stellar trustline](/developers/how-to/stellar_trustline)).
5. **Execute** with `sodax.swaps.swap`.
6. **Track** with `sodax.swaps.getDetailedStatus`, using the source transaction hash, until the swap reaches a final status.

The examples below use a Hedera wallet provider. In a browser, use the one your wallet connection gives you instead.

{/* example: robinhood-stocks/wallet-provider.ts#wallet-provider */}
```typescript
import { ChainKeys, type Hex, type IEvmWalletProvider, spokeChainConfig } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

const hederaWalletProvider: IEvmWalletProvider = new EvmWalletProvider({
  privateKey, // Node.js only; never ship a private key to a browser
  chainId: ChainKeys.HEDERA_MAINNET,
  rpcUrl: spokeChainConfig[ChainKeys.HEDERA_MAINNET].rpcUrl, // the SDK default; use your own node in production
});
```

#### Step 1: Find the stock tokens

Filter a network's swap tokens with `isRealWorldAsset`. How tokens are flagged, including token data that comes from an API, is in [RWA classification](/developers/packages/foundation/sdk/functional-modules/swaps#rwa-classification-and-token-logos).

{/* example: robinhood-stocks/find-stocks.ts#find-stocks */}
```typescript
import { ChainKeys, isRealWorldAsset, Sodax } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.initialize();

// Every tokenized stock and ETF the SDK can swap on Hedera.
const hederaStocks = sodax.swaps.getSupportedSwapTokensByChainId(ChainKeys.HEDERA_MAINNET).filter(isRealWorldAsset);

for (const token of hederaStocks) {
  console.log(`${token.symbol}: ${token.address} (${token.decimals} decimals)`);
}
```

#### Step 2: Quote a buy

This example buys AAPL on Hedera with USDC on Hedera. Amounts are always in the token's smallest unit, so scale by the token's `decimals`.

{/* example: robinhood-stocks/quote.ts#quote */}
```typescript
import { ChainKeys, hederaSupportedTokens, Sodax, type SolverIntentQuoteRequest } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.initialize();

const usdc = hederaSupportedTokens.USDC;
const aapl = hederaSupportedTokens.AAPL;
const amount = 10n * 10n ** BigInt(usdc.decimals); // 10 USDC

const quoteResult = await sodax.swaps.getQuote({
  token_src: usdc.address,
  token_dst: aapl.address,
  token_src_blockchain_id: ChainKeys.HEDERA_MAINNET,
  token_dst_blockchain_id: ChainKeys.HEDERA_MAINNET,
  amount,
  quote_type: 'exact_input',
} satisfies SolverIntentQuoteRequest);

if (!quoteResult.ok) {
  // Branch on quoteResult.error.code, never on the message. Keep the buy button disabled.
  throw new Error('No quote', { cause: quoteResult.error });
}

const slippageBps = 100n; // 1%
const minOutputAmount = (quoteResult.value.quoted_amount * (10_000n - slippageBps)) / 10_000n;
console.log('Minimum AAPL out, in its smallest unit:', minOutputAmount);
```

To sell, swap the two tokens round: the stock is `token_src` and a stablecoin or native token is `token_dst`. The source and destination can be on different networks, for example USDC on Arbitrum into AAPL on Hedera.

#### Steps 3–6: Approve, execute and track

Build `CreateIntentParams` from the quote, then approve, swap and track exactly as in [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap#step-4-check-token-allowance). The only stock-specific parts are the token addresses and the chain keys.

{/* example: robinhood-stocks/execute.ts#execute */}
```typescript
import type { CreateIntentParams } from '@sodax/sdk';

const walletAddress = await hederaWalletProvider.getWalletAddress();

const params: CreateIntentParams<typeof ChainKeys.HEDERA_MAINNET> = {
  inputToken: usdc.address,
  outputToken: aapl.address,
  inputAmount: amount, // from Step 2
  minOutputAmount, // from Step 2, after slippage
  deadline: 0n, // or a deadline from sodax.swaps.getSwapDeadline()
  allowPartialFill: false,
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  dstChainKey: ChainKeys.HEDERA_MAINNET,
  srcAddress: walletAddress,
  dstAddress: walletAddress,
  solver: '0x0000000000000000000000000000000000000000', // any solver
  data: '0x',
};

const allowance = await sodax.swaps.isAllowanceValid({ params, walletProvider: hederaWalletProvider });
if (allowance.ok && !allowance.value) {
  const approve = await sodax.swaps.approve<typeof ChainKeys.HEDERA_MAINNET, false>({
    params,
    walletProvider: hederaWalletProvider,
  });
  if (!approve.ok) throw new Error('Approval failed', { cause: approve.error });
  await hederaWalletProvider.waitForTransactionReceipt(approve.value);
}

const swapResult = await sodax.swaps.swap({ params, walletProvider: hederaWalletProvider });
if (!swapResult.ok) throw new Error(`Swap failed: ${swapResult.error.code}`);

// A one-off read: poll it until a final status, or use useDetailedStatus in React.
const status = await sodax.swaps.getDetailedStatus({
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  srcTxHash: swapResult.value.intentDeliveryInfo.srcTxHash,
});
```

## Bridge path: move a stock back to Robinhood Chain {#bridge-path}

Because every token is backed 1:1, a user holding a stock on Hedera can bridge it back to Robinhood Chain at any time and receive the real Robinhood token. You can offer that in your own app.

### HTTP API {#bridge-http}

Get a partner key at [portal.sodax.com](https://portal.sodax.com) and send it as `x-api-key` from your server on every bridge request. Never send the key from a browser; proxy bridge calls through your server and attach the key there — see [API key good practices](/developers/how-to/api-key-good-practices). For the client package reference see [`@sodax/bridge-api`](/developers/packages/foundation/bridge-api).

The bridge flow over HTTP:

1. **Check capacity** — `POST /v1/bridge/bridgeable-amount` with `srcChainKey`, `dstChainKey`, `inputToken` and `outputToken`. The limit carries its own `decimals`; cross-multiply to compare, as in the TypeScript example below.
2. **Confirm the pair** — `POST /v1/bridge/bridgeable/check` with the same fields.
3. **Check allowance** — `POST /v1/bridge/allowance/check`.
4. **Approve** — `POST /v1/bridge/approve` if needed.
5. **Build the bridge intent tx** — `POST /v1/bridge/intents`. Sign and broadcast the returned `tx` on the source chain.
6. **Submit and track** — `POST /v1/bridge/submit-tx` with the broadcast `txHash` and the full `relayData` envelope from step 5, then poll `GET /v1/bridge/submit-tx/status` until `executed` or `failed`.

<Note>
  When Stellar is the destination, set up the trustline with the wallet SDK before bridging (see [Stellar trustline](/developers/how-to/stellar_trustline#destination-chain-trustline-flow-manual)). There is no HTTP endpoint for this step.
</Note>

### Using TypeScript (SDK) {#bridge-sdk}

`sodax.bridge.bridge()` moves the stock through its shared [vault token](/developers/technical-overview/vault-token) on Sonic in one call.

The steps are:

1. **Confirm the pair** with `sodax.bridge.isBridgeable`. Two tokens are bridgeable when they share the same vault on Sonic.
2. **Check capacity** with `sodax.bridge.getBridgeableAmount`. The limit carries its own `decimals`, so scale before you compare, as below.
3. **Check and approve** with `sodax.bridge.isAllowanceValid` and `sodax.bridge.approve`.
4. **Execute** with `sodax.bridge.bridge`.
5. **Track** with `sodax.bridge.getDetailedStatus`, using the source transaction hash.

{/* example: robinhood-stocks/bridge.ts#bridge */}
```typescript
import { ChainKeys, hederaSupportedTokens, robinhoodSupportedTokens } from '@sodax/sdk';

const from = hederaSupportedTokens.AAPL;
const to = robinhoodSupportedTokens.AAPL;

if (!sodax.bridge.isBridgeable({ from, to })) throw new Error('Not bridgeable');

const limit = await sodax.bridge.getBridgeableAmount(from, to);
if (!limit.ok) throw new Error('No bridge limit', { cause: limit.error });

const amount = 10n ** BigInt(from.decimals) / 100n; // 0.01 AAPL
// The limit can be in either token's decimals: cross-multiply so both sides share a scale.
if (amount * 10n ** BigInt(limit.value.decimals) > limit.value.amount * 10n ** BigInt(from.decimals)) {
  throw new Error(`Above the current limit: ${limit.value.type}`);
}

const params = {
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  srcAddress: hederaAddress,
  srcToken: from.address,
  amount,
  dstChainKey: ChainKeys.ROBINHOOD_MAINNET,
  dstToken: to.address,
  recipient: robinhoodAddress, // the user's address on Robinhood Chain
};

const allowance = await sodax.bridge.isAllowanceValid({ params, walletProvider: hederaWalletProvider });
if (allowance.ok && !allowance.value) {
  const approve = await sodax.bridge.approve<typeof ChainKeys.HEDERA_MAINNET, false>({
    params,
    walletProvider: hederaWalletProvider,
  });
  if (!approve.ok) throw new Error('Approval failed', { cause: approve.error });
  await hederaWalletProvider.waitForTransactionReceipt(approve.value);
}

const result = await sodax.bridge.bridge({ params, walletProvider: hederaWalletProvider });
if (!result.ok) throw new Error(`Bridge failed: ${result.error.code}`);

const status = await sodax.bridge.getDetailedStatus({
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  srcTxHash: result.value.srcChainTxHash,
});
```

The same flow works in every direction between Robinhood Chain, Hedera and Stellar. When Stellar is the destination, set up the trustline first, as in [Stellar trustline](/developers/how-to/stellar_trustline#destination-chain-trustline-flow-manual). Error codes and the timeout model are in [Bridge (SDK)](/developers/packages/foundation/sdk/functional-modules/bridge#error-handling).

## dapp-kit hooks {#dapp-kit-hooks}

Each SDK step has a matching `@sodax/dapp-kit` hook. Mutations expose `mutateAsyncSafe`, which returns a `Result` instead of throwing.

| Step | Swap (buy or sell) | Bridge (move between networks) |
| --- | --- | --- |
| Quote or limit | `useQuote` | `useGetBridgeableAmount` · `useGetBridgeableTokens` |
| Approve | `useSwapAllowance` · `useSwapApprove` | `useBridgeAllowance` · `useBridgeApprove` |
| Execute | `useSwap` | `useBridge` |
| Track | `useDetailedStatus` | `useBridgeDetailedStatus` |

For parameters and polling behaviour, read each hook's source and the [`@sodax/dapp-kit`](/developers/packages/experience/dapp-kit) reference.

## Verify backing on-chain {#verify-backing}

There is no separately published proof of reserves, but anyone can check the backing on-chain. For each ticker, compare:

- **Supply in users' hands on Hedera:** the token's total supply minus what the SODAX SpokeAssetManager on Hedera still holds.
- **Locked on Robinhood Chain:** what the same address holds of the real Robinhood token.

The script below runs the check for AAPL with `@sodax/sdk`, which supplies the addresses, the RPC clients and the ERC-20 ABI. Save it as `verify-backing.ts` and run it with `npx tsx verify-backing.ts`; change the ticker to check another stock.

{/* example: robinhood-stocks/verify-backing.ts#verify-backing */}
```typescript
import {
  ChainKeys,
  erc20Abi,
  hederaSupportedTokens,
  robinhoodSupportedTokens,
  Sodax,
  spokeChainConfig,
} from '@sodax/sdk';

const sodax = new Sodax();
const hedera = sodax.spoke.evm.getPublicClient(ChainKeys.HEDERA_MAINNET);
const robinhood = sodax.spoke.evm.getPublicClient(ChainKeys.ROBINHOOD_MAINNET);

// The SODAX SpokeAssetManager: the same address on Hedera and on Robinhood Chain.
const assetManager = spokeChainConfig[ChainKeys.HEDERA_MAINNET].addresses.assetManager;
const hederaToken = hederaSupportedTokens.AAPL; // change the ticker to check another stock
const robinhoodToken = robinhoodSupportedTokens.AAPL;

const [hederaSupply, hederaHeldBySodax, robinhoodLocked] = await Promise.all([
  hedera.readContract({ address: hederaToken.address, abi: erc20Abi, functionName: 'totalSupply' }),
  hedera.readContract({ address: hederaToken.address, abi: erc20Abi, functionName: 'balanceOf', args: [assetManager] }),
  robinhood.readContract({
    address: robinhoodToken.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [assetManager],
  }),
]);

const hederaCirculating = hederaSupply - hederaHeldBySodax;
const scale = 10n ** BigInt(robinhoodToken.decimals - hederaToken.decimals);

console.log(`In users' hands on Hedera: ${hederaCirculating} (${hederaToken.decimals} decimals)`);
console.log(`Locked on Robinhood Chain: ${robinhoodLocked} (${robinhoodToken.decimals} decimals)`);
console.log('Covers Hedera:', robinhoodLocked >= hederaCirculating * scale);
```

You can also read the same balances in a block explorer: [HashScan](https://hashscan.io/mainnet/contract/0x0df73542cc68bdc01b361d231c60f726b0e0bc05) for Hedera and [Robinhood Chain Blockscout](https://robinhoodchain.blockscout.com/address/0x0df73542cC68bDC01b361d231c60F726B0e0bC05) for Robinhood Chain.

<Note>
  This script checks Hedera only. The same locked tokens also back that ticker on Stellar (7 decimals), so full backing means the locked balance covers the Hedera and Stellar circulating supply combined. A `true` here does not prove that on its own.
</Note>

## Gotchas {#gotchas}

1. **Route through a stablecoin or native token.** Each stock trades only against USDG on Robinhood Chain, so every route passes through USDG. The best-supported swaps are a stablecoin or native token into a stock (for example `USDC`, `USDT`, `ETH` or `S`), and a stock back out to `USDC` or `S`.
2. **Stock-to-stock swaps may fail.** They route stock → USDG → stock and only quote above a small minimum size. A stock on one spoke into another stock on a spoke (for example Hedera AAPL into Hedera NVDA) can need more hops than the router allows and return "no path". Sell into a stablecoin first, then buy.
3. **Mind the decimals.** The same stock has 18 decimals on Robinhood Chain, 8 on Hedera and 7 on Stellar. Amounts are always in the source token's smallest unit, so read `decimals` from the token object.
4. **Tickers are added over time.** Over HTTP, `GET /v1/swaps/tokens` and `GET /v1/bridge/tokens` return the current live set. With the SDK, `sodax.swaps.getSupportedSwapTokensByChainId(chainKey).filter(isRealWorldAsset)` and `sodax.bridge.getBridgeableTokens` return the tokens bundled with your `@sodax/sdk` version; a stock listed after your release needs an SDK update, or the backend API path: list tokens with `sodax.api.swaps.getTokens()` or `sodax.api.bridge.getTokens()` and run the flow through `sodax.api.swaps` or `sodax.api.bridge` (see [Where supported tokens come from](/developers/how-to/configure_sdk#where-supported-tokens-come-from)). Appearing in the vault registry is not proof that a feature is live.
5. **Check the bridge limit before you bridge.** `POST /v1/bridge/bridgeable-amount` (HTTP) or `sodax.bridge.getBridgeableAmount` (SDK) returns the most that can move right now. Disable the action, or cap the amount, when the user asks for more.
6. **Stellar needs a trustline to receive.** When Stellar is the destination, check and create the trustline before you swap or bridge. When Stellar is the source, `isAllowanceValid` and `approve` handle it.
7. **Hedera token association.** Neither the API nor the SDK associates tokens for you on Hedera destinations, so check the recipient and have the user associate first. See [Receiving tokens on Hedera](/hedera/swaps#receiving-tokens-on-hedera).
8. **Branch on `result.ok`, and discriminate on `error.code`.** SDK operations return a `Result` and never throw, and error messages are not stable. Over HTTP, treat `failed` status as real and act on `userMessage` and `failureReason`.
9. **Keep API keys on the server.** A key in a browser bundle is public. See [API key good practices](/developers/how-to/api-key-good-practices).

## Build it with an AI agent {#ai-agents}

Install the [`@sodax/skills`](/ai-integration-guide) bundle before you start the agent, and connect the [Builders MCP](/builders-mcp) so it can read live tokens and quotes. Then describe the task plainly, for example *"Add a stocks tab that lets a Hedera user buy AAPL with USDC using `@sodax/dapp-kit`"*. Check what the agent produces against the [Gotchas](#gotchas).

| Skill | Use it for |
| --- | --- |
| `sodax-sdk-swap` | Buying and selling stocks with `@sodax/sdk` |
| `sodax-sdk-bridge` | Moving a stock between networks with `@sodax/sdk` |
| `sodax-dapp-kit-swap` | The swap hooks in React |
| `sodax-dapp-kit-bridge` | The bridge hooks in React |

## FAQ {#faq}

#### 1. Which stocks are live, and on which networks?

Every ticker is live on Robinhood Chain, Hedera and Stellar, with one vault token per ticker on Sonic. Read the list from `GET /v1/swaps/tokens` over HTTP or from the SDK (see [Live tickers and networks](#live-tickers)); every ticker and address is in [Mainnet deployments](/developers/deployments/mainnet#robinhood-tokenized-equities).

#### 2. Is every Hedera stock token backed 1:1?

Yes. Every stock token on Hedera is backed 1:1 by the real Robinhood token, locked in the SODAX contract on Robinhood Chain. There is no separately published proof of reserves, but anyone can verify the backing on-chain. Compare the Hedera supply held outside the SODAX SpokeAssetManager on Hedera with what the same contract address holds of each token on Robinhood Chain. [Verify backing on-chain](#verify-backing) has a script that does this.

#### 3. Who controls the admin and supply key, and what stops unbacked minting?

SODAX controls the admin and supply key. New stock tokens on Hedera are only issued against Robinhood tokens locked in the SODAX contract on Robinhood Chain, and anyone can check that backing on-chain (see question 2 and [Verify backing on-chain](#verify-backing)).

#### 4. What is the path back to Robinhood Chain for Hedera holders?

Because every token is backed 1:1, anyone holding a stock on Hedera can bridge it back to Robinhood Chain at any time and receive the real Robinhood token. Builders can offer that bridge in their own app with SODAX. See the [Bridge path](#bridge-path).

#### 5. What happens if the SODAX vault on Robinhood Chain were frozen?

SODAX runs sanctions screening across its infrastructure and is verified on the platforms that require it. Robinhood makes these assets available through liquidity providers, and SODAX sources the assets from them. A freeze would hurt Robinhood's own chain and product, so SODAX considers it very unlikely.

#### 6. What fees apply?

A stock swap pays the same fees as any SODAX swap ([swap fees](/developers/packages/foundation/sdk/functional-modules/swaps#get-fees)), plus your own partner fee if you set one ([Monetize SDK](/developers/how-to/monetize_sdk)). Bridges can carry a partner fee too: preview it with `sodax.bridge.getFee` or `POST /v1/bridge/fee` ([Bridge partner fees](/developers/packages/foundation/sdk/functional-modules/bridge#partner-fees)).

#### 7. Are there limits on how much can move?

Yes. `POST /v1/bridge/bridgeable-amount` (HTTP) or `sodax.bridge.getBridgeableAmount` (SDK) returns the most that can be bridged right now, and stock-to-stock swaps only quote above a small minimum size.

## Related

<CardGroup cols={2}>
  <Card title="Swaps API" icon="rotate" href="/developers/http-api/swaps">
    Full HTTP reference for quotes, intents, submit-tx and status polling.
  </Card>
  <Card title="Bridge API" icon="bridge-suspension" href="/developers/packages/foundation/bridge-api">
    HTTP client package for the bridge: endpoints, errors and the submit-tx flow.
  </Card>
  <Card title="Make a swap (SDK)" icon="repeat" href="/developers/how-to/how_to_make_a_swap">
    Every step of an SDK swap, with allowance, status and error handling.
  </Card>
  <Card title="Bridge (SDK)" icon="bridge-suspension" href="/developers/packages/foundation/sdk/functional-modules/bridge">
    Every `sodax.bridge` method, error code and type.
  </Card>
  <Card title="Vault Token" icon="vault" href="/developers/technical-overview/vault-token">
    How one token on Sonic wraps the same asset from many networks.
  </Card>
  <Card title="Mainnet deployments" icon="globe" href="/developers/deployments/mainnet#robinhood-tokenized-equities">
    Every stock token, hub asset and vault address.
  </Card>
</CardGroup>
