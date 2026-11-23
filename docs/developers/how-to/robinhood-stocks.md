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
| Backing, limits and the path back | [FAQ](#faq) |
| Issuer, geo restrictions, audits and liquidity, for partner due diligence | [Stocks due diligence](/developers/how-to/robinhood-stocks-due-diligence) |

## What it is {#what-it-is}

Robinhood Assets (Jersey) Limited issues tokenized stocks, ETFs and commodity funds on Robinhood's own network, Robinhood Chain. Each one is an ordinary token named "Company name - Robinhood Token", for example "Apple - Robinhood Token" (AAPL). SODAX makes the same stocks available on Hedera and Stellar, so your users can hold and trade them without leaving the network they already use.

SODAX uses a hub-and-spoke design. Sonic is the hub, where the core contracts run. Every other network is a spoke that holds assets locally. For background, read [Hub and spoke: how SODAX works](/resources/blog/hub-and-spoke).

Three facts shape the integration:

- **Every Hedera stock token is backed 1:1 by the real Robinhood token.** The real tokens are locked in the SODAX SpokeAssetManager contract on Robinhood Chain. The SpokeAssetManager is the SODAX contract on each spoke that holds deposits and pays out withdrawals.
- **Each ticker is one vault token on Sonic.** A vault token is a single token on the hub that wraps the versions of the same asset from different networks. AAPL on Robinhood Chain, Hedera and Stellar all wrap into the one AAPL vault token, and that shared vault is what lets a stock move between the three networks. See [Vault Token](/developers/technical-overview/vault-token).
- **Stocks are swap assets.** A stock quotes and executes like any other token, through the [Swaps API](/developers/http-api/swaps). Moving the same stock from one network to another uses the [Bridge API](/developers/packages/foundation/bridge-api).

On Hedera, the supply of each stock token is created in advance and held by the SODAX SpokeAssetManager contract (`0x0df73542cC68bDC01b361d231c60F726B0e0bC05`, Hedera account `0.0.10495847`). So the supply in users' hands is the token's total supply minus what that contract still holds. The same contract address holds the locked Robinhood tokens on Robinhood Chain. Hedera stock tokens use Hedera's native token service (HTS) and have no KYC, freeze, wipe or pause keys.

## Live tickers and networks {#live-tickers}

Tickers are added over time, so read the list from the API rather than hard-coding it ([Swap: HTTP API](#swap-http) shows how over HTTP, and [Swap: TypeScript (SDK)](#swap-sdk) shows how in TypeScript). Every live ticker and its addresses are listed in [Mainnet deployments: Robinhood Tokenized Equities](/developers/deployments/mainnet#robinhood-tokenized-equities).

| Network | Role | Token decimals | Where the addresses live (SDK / HTTP) |
| --- | --- | --- | --- |
| Robinhood Chain | Where Robinhood issues the real tokens | 18 | `robinhoodSupportedTokens` / the `robinhood` group of `GET /v1/swaps/tokens` |
| Hedera | Spoke, HTS tokens | 8 | `hederaSupportedTokens` / the `hedera` group |
| Stellar | Spoke, Stellar asset contracts | 7 | `stellarSupportedTokens` / the `stellar` group |
| Sonic | Hub, one vault token per ticker | — | `SodaTokens` / the `hubAsset` and `vault` fields on each token |

Read addresses from `GET /v1/swaps/tokens` or `@sodax/sdk` in code rather than copying them from a page. Each ticker is priced by its Robinhood Chain Chainlink feed where one exists, otherwise by Robinhood's own price API.

Some stocks and ETFs are also money-market reserves; [Money Market on Robinhood Chain](/robinhood-chain/money-market) lists them. Users can supply them from Robinhood Chain, Stellar, Hedera or Sonic and borrow other assets against them; borrowing the stocks themselves is disabled. Every other stock is a swap asset only.

## Choose a path {#choose-a-path}

| | Swap | Bridge |
| --- | --- | --- |
| Use when | A user buys a stock with another token, or sells a stock for another token | A user moves the same stock from one network to another, for example Hedera to Robinhood Chain |
| HTTP API | [Swaps API](/developers/http-api/swaps) | [Bridge: HTTP API](#bridge-http) |
| SDK | `sodax.swaps` | `sodax.bridge` |
| React | `useQuote`, `useSwap` and related hooks | `useBridge` and related hooks |
| Who fills it | A solver on the SODAX marketplace | No solver. The hub moves the asset through the shared vault |

## Prerequisites

For HTTP and SDK alike:

- A SODAX API key from [portal.sodax.com](https://portal.sodax.com), kept on your server and sent as `x-api-key` on swap `POST` calls and on bridge calls. See [API keys](/developers/how-to/api-keys).
- A wallet on the network your user starts from, with enough of the native token to pay network fees (HBAR on Hedera, XLM on Stellar, ETH on Robinhood Chain)
- RPC access to the networks you use; a dedicated node provider is better in production

For the TypeScript SDK path, additionally:

- The `@sodax/sdk` package installed, plus `@sodax/wallet-sdk-core` (or `@sodax/wallet-sdk-react` in a React app) for wallet providers. The SDK's default RPC URLs are in `spokeChainConfig`

SODAX is mainnet-only, so test with small amounts. See [Is SODAX on Testnet?](/developers/how-to/testnet).

## Swap path: buy or sell a stock {#swap-path}

### HTTP API {#swap-http}

The swap flow over HTTP uses the same endpoints as any other token. For the full endpoint reference see [Swaps API](/developers/http-api/swaps).

#### Find the stock tokens {#find-stocks-http}

`GET /v1/swaps/tokens` returns the swap tokens grouped by chain key. Keep the `robinhood`, `hedera` and `stellar` groups, then the tokens with `isRwa: true`. That filter returns every real-world-asset token on those chains, not only Robinhood stocks; match the result against the [Robinhood Tokenized Equities deployments list](/developers/deployments/mainnet#robinhood-tokenized-equities) to keep just the stocks.

```bash
curl -s 'https://api.sodax.com/v1/swaps/tokens' | jq '
  [to_entries[]
   | select(.key | IN("robinhood", "hedera", "stellar"))
   | .value[] | select(.isRwa == true)
   | {chainKey, symbol, address, decimals}]'
```

Use the `address` and `chainKey` values in the quote and intent calls below.

<Note>
  `isRwa` is served live but is not in the OpenAPI schema or the `SwapTokenV2` type. Non-RWA tokens omit the field instead of sending `false`, so test `== true`. A typed client needs a raw read or a cast to see it.
</Note>

#### Quote, approve, execute and track {#swap-http-steps}

The stock-specific flow is identical to any other token swap; stock tokens use no special endpoints. For the full step-by-step, with request bodies and response shapes, see [Swaps API](/developers/http-api/swaps):

1. **Quote** — `POST /v1/swaps/quote` with `tokenSrc`, `tokenSrcChainKey`, `tokenDst`, `tokenDstChainKey`, `amount` (in the source token's smallest unit, as a decimal string) and `quoteType: "exact_input"`.
2. **Apply slippage** to `quotedAmount` on the client side. Never pass `0` as `minOutputAmount`.
3. **Check allowance** — `POST /v1/swaps/allowance/check`. Steps 3, 4 and 5 all send the same body: `srcChainKey`, `dstChainKey`, `inputToken`, `outputToken`, `inputAmount`, `minOutputAmount`, `deadline` (decimal strings for the amounts and `deadline`), `allowPartialFill`, `srcAddress` and `dstAddress`; `solver` and `data` are optional. Map the quote fields onto it: `tokenSrc` → `inputToken`, `tokenSrcChainKey` → `srcChainKey`, `tokenDst` → `outputToken`, `tokenDstChainKey` → `dstChainKey`, `amount` → `inputAmount`. Get `deadline` from `GET /v1/swaps/deadline` first (`"0"` makes a limit order that never expires).
4. **Approve** — `POST /v1/swaps/approve` with the same body if allowance is insufficient. Sign and broadcast the returned approval transaction and wait for its receipt. Continue only if the receipt shows success; a reverted approval leaves the allowance unchanged. With a Stellar source, steps 3 and 4 check and set up the trustline instead.
5. **Build the intent tx** — `POST /v1/swaps/intents` with the same body. Keep the returned `intent` for steps 6 and 7. Sign and broadcast the returned `tx` on the source chain, wait for the receipt and require that it succeeded, not reverted, before you submit.
6. **Submit and track** — only after the step 5 receipt succeeded, `POST /v1/swaps/submit-tx` with `txHash`, `srcChainKey`, `walletAddress`, the `intent` from step 5 and `relayData`, which is the hex string `relayData.payload`, not the object (all five are required), as in the [Swaps bot flow](/developers/http-api/swaps#bot-flow-create-submit-tx-poll). Treat `success: true` with `data.status` `inserted` or `duplicate` as accepted. `submit-tx` is idempotent on `(txHash, srcChainKey)`, so after a lost response or a transient 5xx, resend the same body, and never broadcast a second source transaction. Back off on `429` (implement your own backoff), and surface a persistent 4xx error instead of retrying it. Then poll `GET /v1/swaps/submit-tx/status?txHash=…&srcChainKey=…`. Stop when `status` is `solved`, when it is `failed`, or when `abandonedAt` is set. On `failed` or `abandonedAt`, show `userMessage`, or a generic failure text if it is missing.
7. **Cancel an open intent** — when the swap is `failed` or `abandonedAt` is set, show `userMessage`. If `intentCancelled` is not `true` and `relayedForRefundAt` is not set, `POST /v1/swaps/intents/cancel` with `{ srcChainKey, intent }`, using the `intent` kept from step 5, then sign and broadcast the returned `tx`. If `relayedForRefundAt` is set, do not cancel: the refund is already relayed. See [Swaps API](/developers/http-api/swaps#4-poll-status).

<Note>
  Prepare the destination before you swap. A Stellar recipient needs a trustline for the token: use `sodax.spoke.stellar.requestTrustline` from `@sodax/sdk`, or any Stellar SDK's `ChangeTrust` operation (see [Stellar trustline](/developers/how-to/stellar_trustline#destination-chain-trustline-flow-manual)). A Hedera recipient must associate the token (see [Receiving tokens on Hedera](/hedera/swaps#receiving-tokens-on-hedera)). There is no HTTP endpoint for either.
</Note>

### Using TypeScript (SDK) {#swap-sdk}

Set up `Sodax` and a wallet provider first, as in [Configure the SDK](/developers/how-to/configure_sdk) and [Wallet providers](/developers/how-to/wallet_providers). Hedera and Robinhood Chain are EVM networks, so both use `IEvmWalletProvider`. Stellar uses `IStellarWalletProvider`.

A stock swap is the same flow as [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap), which has the full detail. Find stocks by filtering a network's supported tokens with `isRealWorldAsset`. Quote with `sodax.swaps.getQuote`, then apply your slippage to get `minOutputAmount`; never send `0n`. Check and approve with `sodax.swaps.isAllowanceValid` and `sodax.swaps.approve` (on Stellar this sets up a trustline instead; see [Stellar trustline](/developers/how-to/stellar_trustline)). Execute with `sodax.swaps.swap`, and track with `sodax.swaps.getDetailedStatus` using the source transaction hash until the swap reaches a final status.

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

#### Find the stock tokens with the SDK

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

#### Quote a buy

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

#### Approve, execute and track with the SDK

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
  const approve = await sodax.swaps.approve({
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

Because every token is backed 1:1, a user holding a stock on Hedera can bridge it back to Robinhood Chain, when the pair is supported and capacity allows, and receive the real Robinhood token, up to the limit `POST /v1/bridge/bridgeable-amount` or `sodax.bridge.getBridgeableAmount` returns at that moment. You can offer that in your own app.

### HTTP API {#bridge-http}

The base URL is `https://api.sodax.com`, and the paths below include the `/v1/bridge` prefix. Send your `x-api-key` from your server on every bridge request; never from a browser — see [API key good practices](/developers/how-to/api-key-good-practices). Request and response bodies are typed in [`backendBridgeApiV2.ts`](https://github.com/gosodax/sodax-sdks/blob/main/packages/types/src/backend/backendBridgeApiV2.ts), and [`@sodax/bridge-api`](/developers/packages/foundation/bridge-api) is the TypeScript client.

The bridge flow over HTTP:

1. **Confirm the pair** — `POST /v1/bridge/bridgeable/check` with `srcChainKey`, `dstChainKey`, `inputToken` and `outputToken`. Continue only when `bridgeable` is `true`.
2. **Check capacity** — `POST /v1/bridge/bridgeable-amount` with the same four fields. The response `limit` has `amount` (smallest unit, decimal string), `decimals` and `type`. Continue only when your amount is within it: `amount × 10^limit.decimals ≤ limit.amount × 10^tokenDecimals`, where `amount` is in the input token's smallest unit and `tokenDecimals` is the input token's `decimals`. Cross-multiplying avoids mixing scales, as in the TypeScript example below.
3. **Check allowance** — `POST /v1/bridge/allowance/check` with `srcChainKey`, `dstChainKey`, `inputToken`, `outputToken`, `inputAmount` (smallest unit, decimal string), `srcAddress` and `dstAddress`. Steps 4 and 5 send the same seven fields.
4. **Approve** — `POST /v1/bridge/approve` if needed. Sign and broadcast the returned approval transaction and wait for its receipt. Continue only if the receipt shows success. With a Stellar source, steps 3 and 4 check and set up the trustline instead.
5. **Build the bridge intent tx** — `POST /v1/bridge/intents`. Sign and broadcast the returned `tx` on the source chain, wait for the receipt and require that it succeeded, not reverted, before you submit.
6. **Submit and track** — only after the step 5 receipt succeeded, `POST /v1/bridge/submit-tx` with `txHash`, `srcChainKey`, `walletAddress` and the whole `relayData` object (`address` and `payload`) from step 5, unlike swaps (all four are required). Treat `success: true` with `data.status` `inserted` or `duplicate` as accepted. After a lost response or a transient 5xx, resend the same body rather than broadcasting a second source transaction; back off on `429`, and surface a persistent 4xx error instead of retrying it. Then poll `GET /v1/bridge/submit-tx/status?txHash=…&srcChainKey=…` and read the outcome in this order: `executed` with `result.dstIntentTxHash` set is success. `executed` without it: keep polling for a bounded time, then your app reconciles using the source `txHash` and `srcChainKey`. `failed`, or `abandonedAt` set: failure, so show `userMessage`, or a generic failure text if it is missing.

<Note>
  Prepare a Stellar or Hedera destination first, as in the [swap note](#swap-http-steps): a trustline on Stellar, a token association on Hedera.
</Note>

### Using TypeScript (SDK) {#bridge-sdk}

Set up `Sodax` and a wallet provider as in [Swap: TypeScript (SDK)](#swap-sdk). `sodax.bridge.bridge()` moves the stock through its shared [vault token](/developers/technical-overview/vault-token) on Sonic in one call.

Confirm the pair with `sodax.bridge.isBridgeable`: two tokens are bridgeable when they share the same vault on Sonic. Check capacity with `sodax.bridge.getBridgeableAmount`; the limit carries its own `decimals`, so scale before you compare, as below. Check and approve with `sodax.bridge.isAllowanceValid` and `sodax.bridge.approve`, execute with `sodax.bridge.bridge`, and track with `sodax.bridge.getDetailedStatus` using the source transaction hash.

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
  const approve = await sodax.bridge.approve({
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
  This script checks Hedera only. The same locked tokens also back that ticker on Stellar (7 decimals) and Sonic, so full backing means the locked balance covers the supply in users' hands on all three combined. A `true` here does not prove that on its own.
</Note>

## Gotchas {#gotchas}

1. **Route through a stablecoin or native token.** Each stock trades only against USDG on Robinhood Chain, so every route passes through USDG. The best-supported swaps are a stablecoin or native token into a stock (for example `USDC`, `USDT`, `ETH` or `S`), and a stock back out to `USDC` or `S`.
2. **Stock-to-stock swaps may fail.** They route stock → USDG → stock and only quote above a small minimum size. A stock on one spoke into another stock on a spoke (for example Hedera AAPL into Hedera NVDA) can need more hops than the router allows and return "no path". Sell into a stablecoin first, then buy.
3. **Mind the decimals.** The same stock has 18 decimals on Robinhood Chain, 8 on Hedera and 7 on Stellar. Input amounts are in the source token's smallest unit, `minOutputAmount` is in the destination token's smallest unit, and a bridge limit is in its own `limit.decimals`, so read `decimals` from each token object.
4. **Tickers are added over time.** Over HTTP, `GET /v1/swaps/tokens` and `GET /v1/bridge/tokens` return the current live set. With the SDK, `sodax.swaps.getSupportedSwapTokensByChainId(chainKey).filter(isRealWorldAsset)` and `sodax.bridge.getBridgeableTokens` return the tokens bundled with your `@sodax/sdk` version, and `sodax.swaps` and `sodax.bridge` accept only those. A stock listed after your release needs an SDK update, or the backend API path: list tokens with `sodax.api.swaps.getTokens()` or `sodax.api.bridge.getTokens()` and run the flow through `sodax.api.swaps` or `sodax.api.bridge` (see [Where supported tokens come from](/developers/how-to/configure_sdk#where-supported-tokens-come-from)). `isRealWorldAsset` also knows only the bundled tokens, so classify a newer one by `isRwa` in the raw `GET /v1/swaps/tokens` response (the field is outside the typed schema; see the [note above](#find-stocks-http)). Appearing in the vault registry is not proof that a feature is live.
5. **Check the bridge limit before you bridge.** `POST /v1/bridge/bridgeable-amount` (HTTP) or `sodax.bridge.getBridgeableAmount` (SDK) returns the most that can move right now. Disable the action, or cap the amount, when the user asks for more.
6. **Stellar needs a trustline to receive.** When Stellar is the destination, check and create the trustline before you swap or bridge. When Stellar is the source, `isAllowanceValid` and `approve` handle it in the SDK. Over HTTP, use `POST /v1/swaps/allowance/check` and `POST /v1/swaps/approve` for swaps, and `POST /v1/bridge/allowance/check` and `POST /v1/bridge/approve` for bridges. No HTTP endpoint adds a trustline for a destination. For a new Stellar account, `POST /v1/sponsorships/stellar/accounts` activates it; it needs the sponsoring `x-api-key` and a base64 activation transaction signed by the new account (see [Stellar sponsoring](/developers/how-to/stellar-sponsoring-getting-started)). The trustline is still a separate transaction.
7. **Hedera token association.** Neither the API nor the SDK associates tokens for you on Hedera destinations, so check the recipient and have the user associate first. See [Receiving tokens on Hedera](/hedera/swaps#receiving-tokens-on-hedera).
8. **Branch on `result.ok`, and discriminate on `error.code`.** SDK operations return a `Result` and never throw, and error messages are not stable. Over HTTP, treat `failed` status as real: act on `userMessage` and cancel an open swap intent as in [swap step 7](#swap-http-steps), and only log `failureReason` and `failedAtStep`.
9. **Keep API keys on the server.** A key in a browser bundle is public. See [API key good practices](/developers/how-to/api-key-good-practices).

## Build it with an AI agent {#ai-agents}

Install the [`@sodax/skills`](/ai-integration-guide) bundle before you start the agent, and connect the [SODAX MCP](/sodax-mcp) so it can read live tokens and quotes. Then describe the task plainly, for example *"Add a stocks tab that lets a Hedera user buy AAPL with USDC using `@sodax/dapp-kit`"*. Check what the agent produces against the [Gotchas](#gotchas).

| Skill | Use it for |
| --- | --- |
| `sodax-sdk-swap` | Buying and selling stocks with `@sodax/sdk` |
| `sodax-sdk-bridge` | Moving a stock between networks with `@sodax/sdk` |
| `sodax-dapp-kit-swap` | The swap hooks in React |
| `sodax-dapp-kit-bridge` | The bridge hooks in React |

## FAQ {#faq}

#### 1. Which stocks are live, and on which networks?

Every ticker is live on Robinhood Chain, Hedera and Stellar, with one vault token per ticker on Sonic. Read the list over HTTP, filtered as in [Find the stock tokens](#find-stocks-http), or from the SDK; every ticker and address is in [Mainnet deployments](/developers/deployments/mainnet#robinhood-tokenized-equities).

#### 2. Is every Hedera stock token backed 1:1?

Yes. Every stock token on Hedera is backed 1:1 by the real Robinhood token, locked in the SODAX contract on Robinhood Chain. There is no separately published proof of reserves, but anyone can check the Hedera side on-chain. Compare the Hedera supply held outside the SODAX SpokeAssetManager on Hedera with what the same contract address holds of each token on Robinhood Chain. [Verify backing on-chain](#verify-backing) has a script that does this. It checks Hedera only. The same locked tokens also back Stellar and Sonic. A passing check does not prove full backing on its own.

#### 3. How is the Hedera supply issued, and how can I check it?

The supply of each Hedera stock token is created in advance and held by the SODAX SpokeAssetManager on Hedera (see [What it is](#what-it-is)). Users hold only the tokens that the SpokeAssetManager has released from that supply. The locked Robinhood tokens sit in the SODAX contract on Robinhood Chain, and anyone can compare the two on-chain (see question 2 and [Verify backing on-chain](#verify-backing)).

#### 4. What is the path back to Robinhood Chain for Hedera holders?

Because every token is backed 1:1, anyone holding a stock on Hedera can bridge it back to Robinhood Chain, when the pair is supported and capacity allows, and receive the real Robinhood token. At that moment, the bridge back depends on sanctions screening, Robinhood's restrictions and the bridge limit (see question 7). Builders can offer that bridge in their own app with SODAX. See the [Bridge path](#bridge-path).

#### 5. What happens if the SODAX vault on Robinhood Chain were frozen?

SODAX considers a freeze very unlikely for two reasons. It screens wallet addresses against sanctions lists before swaps and bridges. It also sources the assets from liquidity providers that Robinhood works with. SODAX has not published what a freeze would mean for holders.

#### 6. What fees apply?

A stock swap pays the same fees as any SODAX swap ([swap fees](/developers/packages/foundation/sdk/functional-modules/swaps#get-fees)), plus your own partner fee if you set one ([Monetize SDK](/developers/how-to/monetize_sdk)). Bridges can carry a partner fee too: preview it with `sodax.bridge.getFee` or `POST /v1/bridge/fee` ([Bridge partner fees](/developers/packages/foundation/sdk/functional-modules/bridge#partner-fees)).

#### 7. Are there limits on how much can move?

Yes. `POST /v1/bridge/bridgeable-amount` (HTTP) or `sodax.bridge.getBridgeableAmount` (SDK) returns the most that can be bridged right now. Stock-to-stock swaps only quote above a small minimum size.

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
