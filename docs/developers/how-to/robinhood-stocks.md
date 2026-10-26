---
title: "Add Robinhood stocks to your app"
sidebarTitle: "Robinhood stocks"
description: "Let your users buy, sell and move Robinhood tokenized stocks and ETFs on Hedera, Stellar and Robinhood Chain: how the tokens are backed, the @sodax/sdk swap and bridge flow, the dapp-kit hooks, how to verify backing on-chain, and the gotchas."
icon: chart-line
---

Use this guide to add Robinhood tokenized stocks to your app with SODAX. Your users can buy a stock with a token they already hold, sell it back, and move it between Hedera, Stellar and Robinhood Chain. The guide covers how the tokens work, the order of the steps and the rules that matter. Signatures, types and full working code live in the references it links to, and those are what to copy from.

| Find an answer | Go to |
| --- | --- |
| What the tokens are, and how they are backed | [What it is](#what-it-is) |
| Which tickers and networks are live | [Live tickers and networks](#live-tickers) |
| Which SDK feature to use | [Choose a path](#choose-a-path) |
| Buy or sell a stock in TypeScript | [Swap path](#swap-path) |
| Move a stock back to Robinhood Chain | [Bridge path](#bridge-path) |
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
- **Stocks are swap assets.** A stock quotes and executes like any other token, through `sodax.swaps`. Moving the same stock from one network to another uses `sodax.bridge`.

On Hedera, the supply of each stock token is created in advance and held by the SODAX SpokeAssetManager contract (`0x0df73542cC68bDC01b361d231c60F726B0e0bC05`, Hedera account `0.0.10495847`). So the supply in users' hands is the token's total supply minus what that contract still holds. The same contract address holds the locked Robinhood tokens on Robinhood Chain. Hedera stock tokens use Hedera's native token service (HTS), have 8 decimals, and have no KYC, freeze, wipe or pause keys.

## Live tickers and networks {#live-tickers}

24 tickers are live. Read the list at runtime rather than hard-coding it, because tickers are added over time (see [Gotchas](#gotchas)).

| Type | Tickers |
| --- | --- |
| Stocks | AAPL, AMD, AMZN, BABA, COIN, CRCL, GME, GOOGL, INTC, META, MSFT, MSTR, MU, NVDA, PLTR, SNDK, SPCX, TSLA, TSM |
| ETFs and funds | QQQ, SGOV, SLV, SPY, USO |

| Network | Role | Token decimals | Where the addresses live |
| --- | --- | --- | --- |
| Robinhood Chain | Where Robinhood issues the real tokens | 18 | `robinhoodSupportedTokens` |
| Hedera | Spoke, HTS tokens | 8 | `hederaSupportedTokens` |
| Stellar | Spoke, Stellar asset contracts | 7 | `stellarSupportedTokens` |
| Sonic | Hub, one vault token per ticker | — | `SodaTokens` |

Every address is in [Mainnet deployments: Robinhood Tokenized Equities](/developers/deployments/mainnet#robinhood-tokenized-equities) and in `@sodax/types`, which `@sodax/sdk` re-exports. Read addresses from the package in code rather than copying them from a page. Only tickers with a Chainlink price feed on Robinhood Chain are listed, so some Robinhood tokens (for example DJT, RDDT and GLD) are not available.

Stocks are swap assets only. They are not money-market reserves, so users cannot supply them, borrow against them or use them as collateral.

## Choose a path {#choose-a-path}

| | Swap | Bridge |
| --- | --- | --- |
| Use when | A user buys a stock with another token, or sells a stock for another token | A user moves the same stock from one network to another, for example Hedera to Robinhood Chain |
| SDK | `sodax.swaps` | `sodax.bridge` |
| React | `useQuote`, `useSwap` and related hooks | `useBridge` and related hooks |
| Who fills it | A solver on the SODAX marketplace | No solver. The hub moves the asset through the shared vault |
| HTTP alternative | [Swaps API](/developers/http-api/swaps) | No bridge write API yet. Use the SDK |

Set up `Sodax` and a wallet provider first, as in [Configure the SDK](/developers/how-to/configure_sdk) and [Wallet providers](/developers/how-to/wallet_providers). Hedera and Robinhood Chain are EVM networks, so both use `IEvmWalletProvider`. Stellar uses `IStellarWalletProvider`.

## Prerequisites

Before you begin, ensure you have:

- The `@sodax/sdk` package installed, plus `@sodax/wallet-sdk-core` (or `@sodax/wallet-sdk-react` in a React app) for wallet providers
- A wallet on the network your user starts from, with enough of the native token to pay network fees (HBAR on Hedera, XLM on Stellar, ETH on Robinhood Chain)
- RPC URLs for the networks you use. The SDK defaults are `https://mainnet.hashio.io/api` for Hedera and `https://rpc.mainnet.chain.robinhood.com` for Robinhood Chain; a dedicated node provider is better in production
- A SODAX API key kept on your server. See [API keys](/developers/how-to/api-keys)

SODAX is mainnet-only, so test with small amounts. See [Is SODAX on Testnet?](/developers/how-to/testnet).

The examples below use a Hedera wallet provider. In a browser, use the one your wallet connection gives you instead.

```typescript
import { ChainKeys, type IEvmWalletProvider, type Hex } from '@sodax/sdk';
import { EvmWalletProvider } from '@sodax/wallet-sdk-core';

const hederaWalletProvider: IEvmWalletProvider = new EvmWalletProvider({
  privateKey: '0x...' as Hex, // Node.js only; never ship a private key to a browser
  chainId: ChainKeys.HEDERA_MAINNET,
  rpcUrl: 'https://mainnet.hashio.io/api',
});
```

## Swap path: buy or sell a stock {#swap-path}

A stock swap is the same flow as [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap). Follow that guide for the full detail. The steps are:

1. **Find the stock tokens.** Filter the supported tokens on a network with `isRealWorldAsset` to build a stocks list.
2. **Quote** with `sodax.swaps.getQuote`.
3. **Apply your slippage** to the quoted amount to get `minOutputAmount`. Never send `0n`.
4. **Check and approve** with `sodax.swaps.isAllowanceValid` and `sodax.swaps.approve`. On Stellar this sets up a trustline instead (see [Stellar trustline](/developers/how-to/stellar_trustline)).
5. **Execute** with `sodax.swaps.swap`.
6. **Track** with `sodax.swaps.getDetailedStatus`, using the source transaction hash, until the swap reaches a final status.

### Step 1: Find the stock tokens

`XToken.isRwa === true` marks a registered tokenized stock, ETF or commodity. `isRealWorldAsset({ chainKey, address })` resolves the same flag for token data that comes from an API.

```typescript
import { ChainKeys, getSupportedSolverTokens, isRealWorldAsset } from '@sodax/sdk';

// Every tokenized stock and ETF a solver can swap on Hedera.
const hederaStocks = getSupportedSolverTokens(ChainKeys.HEDERA_MAINNET).filter(isRealWorldAsset);

hederaStocks.forEach(token => {
  console.log(`${token.symbol}: ${token.address} (${token.decimals} decimals)`);
});
```

### Step 2: Quote a buy

This example buys AAPL on Hedera with USDC on Hedera. Amounts are always in the token's smallest unit: USDC on Hedera has 6 decimals, so 10 USDC is `10_000_000n`.

```typescript
import { Sodax, ChainKeys, hederaSupportedTokens, type SolverIntentQuoteRequest } from '@sodax/sdk';

const sodax = new Sodax();
await sodax.initialize(); // non-fatal on failure; the SDK falls back to packaged defaults

const usdc = hederaSupportedTokens.USDC; // 6 decimals
const aapl = hederaSupportedTokens.AAPL; // 8 decimals

const quoteResult = await sodax.swaps.getQuote({
  token_src: usdc.address,
  token_dst: aapl.address,
  token_src_blockchain_id: ChainKeys.HEDERA_MAINNET,
  token_dst_blockchain_id: ChainKeys.HEDERA_MAINNET,
  amount: 10_000_000n, // 10 USDC
  quote_type: 'exact_input',
} satisfies SolverIntentQuoteRequest);

if (!quoteResult.ok) {
  // Branch on quoteResult.error.code, never on the message. Keep the buy button disabled.
  console.error('No quote:', quoteResult.error);
  return;
}

const slippageBps = 100n; // 1%
const minOutputAmount = (quoteResult.value.quoted_amount * (10_000n - slippageBps)) / 10_000n;
console.log('Minimum AAPL out (8 decimals):', minOutputAmount);
```

To sell, swap the two tokens round: the stock is `token_src` and a stablecoin or native token is `token_dst`. The source and destination can be on different networks, for example USDC on Arbitrum into AAPL on Hedera.

### Steps 3 to 6: Approve, execute and track

Build `CreateIntentParams` from the quote, then approve, swap and track exactly as in [Make a swap (SDK)](/developers/how-to/how_to_make_a_swap#step-4-check-token-allowance). The only stock-specific parts are the token addresses and the chain keys.

```typescript
import type { CreateIntentParams } from '@sodax/sdk';

const walletAddress = await hederaWalletProvider.getWalletAddress();

const params: CreateIntentParams<typeof ChainKeys.HEDERA_MAINNET> = {
  inputToken: usdc.address,
  outputToken: aapl.address,
  inputAmount: 10_000_000n,
  minOutputAmount,                // from Step 2, after slippage
  deadline: 0n,                   // or a deadline from sodax.swaps.getSwapDeadline()
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
  const approve = await sodax.swaps.approve({ params, walletProvider: hederaWalletProvider });
  if (!approve.ok) return;
  await hederaWalletProvider.waitForTransactionReceipt(approve.value);
}

const swapResult = await sodax.swaps.swap({ params, walletProvider: hederaWalletProvider });
if (!swapResult.ok) {
  console.error('Swap failed:', swapResult.error.code);
  return;
}

const status = await sodax.swaps.getDetailedStatus({
  srcChainKey: ChainKeys.HEDERA_MAINNET,
  srcTxHash: swapResult.value.intentDeliveryInfo.srcTxHash,
});
// getDetailedStatus is a one-off read: poll it until a final status, or use useDetailedStatus in React.
```

## Bridge path: move a stock back to Robinhood Chain {#bridge-path}

Because every token is backed 1:1, a user holding a stock on Hedera can bridge it back to Robinhood Chain at any time and receive the real Robinhood token. You can offer that in your own app.

Under the hood, the user deposits the Hedera token into the SODAX SpokeAssetManager on Hedera. That creates the matching hub asset on Sonic, which wraps into the stock's vault token. The vault token is then withdrawn to Robinhood Chain, where the user receives the real Robinhood token from the SODAX contract there. `sodax.bridge.bridge()` runs all of this in one call.

The steps are:

1. **Confirm the pair** with `sodax.bridge.isBridgeable`. Two tokens are bridgeable when they share the same vault on Sonic.
2. **Check capacity** with `sodax.bridge.getBridgeableAmount`. It returns the most that can move right now, with its own `decimals`: a `DEPOSIT_LIMIT` is in the source token's units, a `WITHDRAWAL_LIMIT` in the destination token's. Scale before you compare.
3. **Check and approve** with `sodax.bridge.isAllowanceValid` and `sodax.bridge.approve`.
4. **Execute** with `sodax.bridge.bridge`.
5. **Track** with `sodax.bridge.getDetailedStatus`, using the source transaction hash.

```typescript
import { ChainKeys, hederaSupportedTokens, robinhoodSupportedTokens } from '@sodax/sdk';

const from = hederaSupportedTokens.AAPL;      // 8 decimals
const to = robinhoodSupportedTokens.AAPL;     // 18 decimals

if (!sodax.bridge.isBridgeable({ from, to })) throw new Error('Not bridgeable');

const limit = await sodax.bridge.getBridgeableAmount(from, to);
if (!limit.ok) return;

const amount = 1_000_000n; // 0.01 AAPL in Hedera's 8 decimals
// Cross-multiply so both sides share a scale: the limit may be in Robinhood's 18 decimals.
if (amount * 10n ** BigInt(limit.value.decimals) > limit.value.amount * 10n ** BigInt(from.decimals)) {
  console.log('Above the current limit:', limit.value.type); // 'DEPOSIT_LIMIT' | 'WITHDRAWAL_LIMIT'
  return;
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
  const approve = await sodax.bridge.approve({ params, walletProvider: hederaWalletProvider });
  if (!approve.ok) return;
  await hederaWalletProvider.waitForTransactionReceipt(approve.value);
}

const result = await sodax.bridge.bridge({ params, walletProvider: hederaWalletProvider });
if (!result.ok) {
  console.error('Bridge failed:', result.error.code);
  return;
}

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

- **Supply in users' hands on Hedera:** the token's total supply minus what the SODAX Hedera contract (`0x0df73542cC68bDC01b361d231c60F726B0e0bC05`) still holds.
- **Locked on Robinhood Chain:** what the same address holds of the real Robinhood token.

The script below runs the check for AAPL with [viem](https://viem.sh) in Node.js 18 or later (save it as `verify.mjs` and run `node verify.mjs`). Swap in any other ticker's addresses from [Mainnet deployments](/developers/deployments/mainnet#spoke-side-addresses).

```javascript
import { createPublicClient, http, erc20Abi, formatUnits } from 'viem';

// SODAX SpokeAssetManager: the same address on Hedera and on Robinhood Chain.
const SODAX_SPOKE_ASSET_MANAGER = '0x0df73542cC68bDC01b361d231c60F726B0e0bC05';

const HEDERA_TOKEN = '0x0000000000000000000000000000000000a567e1';    // AAPL on Hedera (8 decimals)
const ROBINHOOD_TOKEN = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'; // AAPL on Robinhood Chain (18 decimals)

const hedera = createPublicClient({ transport: http('https://mainnet.hashio.io/api') });
const robinhood = createPublicClient({ transport: http('https://rpc.mainnet.chain.robinhood.com') });

const read = (client, address, functionName, args = []) =>
  client.readContract({ address, abi: erc20Abi, functionName, args });

const [hederaSupply, hederaHeldBySodax, robinhoodLocked] = await Promise.all([
  read(hedera, HEDERA_TOKEN, 'totalSupply'),
  read(hedera, HEDERA_TOKEN, 'balanceOf', [SODAX_SPOKE_ASSET_MANAGER]),
  read(robinhood, ROBINHOOD_TOKEN, 'balanceOf', [SODAX_SPOKE_ASSET_MANAGER]),
]);

const hederaCirculating = hederaSupply - hederaHeldBySodax;

console.log('In users\' hands on Hedera:', formatUnits(hederaCirculating, 8));
console.log('Locked on Robinhood Chain: ', formatUnits(robinhoodLocked, 18));
console.log('Covers Hedera:', robinhoodLocked >= hederaCirculating * 10n ** 10n); // scale 8 to 18 decimals
```

You can also read the same balances in a block explorer: [HashScan](https://hashscan.io/mainnet/contract/0x0df73542cc68bdc01b361d231c60f726b0e0bc05) for Hedera and [Robinhood Chain Blockscout](https://robinhoodchain.blockscout.com/address/0x0df73542cC68bDC01b361d231c60F726B0e0bC05) for Robinhood Chain.

<Note>
  This script checks Hedera only. The same locked tokens also back that ticker on Stellar (7 decimals), so full backing means the locked balance covers the Hedera and Stellar circulating supply combined. A `true` here does not prove that on its own.
</Note>

## Gotchas {#gotchas}

1. **Route through a stablecoin or native token.** Each stock trades only against USDG on Robinhood Chain, so every route passes through USDG. The best-supported swaps are a stablecoin or native token into a stock (for example `USDC`, `USDT`, `ETH` or `S`), and a stock back out to `USDC` or `S`.
2. **Stock-to-stock swaps may fail.** They route stock → USDG → stock and only quote above a small minimum size. A stock on one spoke into another stock on a spoke (for example Hedera AAPL into Hedera NVDA) can need more hops than the router allows and return "no path". Sell into a stablecoin first, then buy.
3. **Mind the decimals.** The same stock has 18 decimals on Robinhood Chain, 8 on Hedera and 7 on Stellar. Amounts are always in the source token's smallest unit, so read `decimals` from the token object.
4. **Read tickers at runtime.** Use `getSupportedSolverTokens(chainKey).filter(isRealWorldAsset)` for the swap list, and `sodax.bridge.getBridgeableTokens` for bridge targets. Appearing in the vault registry is not proof that a feature is live; the backend config decides. New registry entries need an SDK update.
5. **Check the bridge limit before you bridge.** `getBridgeableAmount` returns the most that can move right now. Disable the action, or cap the amount, when the user asks for more.
6. **Stellar needs a trustline to receive.** When Stellar is the destination, check and create the trustline before you swap or bridge. When Stellar is the source, `isAllowanceValid` and `approve` handle it.
7. **Hedera token association.** On Hedera, a recipient can only receive an HTS stock token if the account is associated with that token or still has a free automatic association slot. Accounts auto-created at an EVM address usually have unlimited slots; other accounts may have few or none. The SDK does not associate for you on Hedera destinations, so check the recipient (mirror node) and have the user associate before you deliver. See [Receiving tokens on Hedera](/hedera/swaps#receiving-tokens-on-hedera) in the Hedera swaps guide.
8. **Stocks are not collateral.** They cannot be supplied or borrowed against in the money market.
9. **Branch on `result.ok`, and discriminate on `error.code`.** SDK operations return a `Result` and never throw, and error messages are not stable.
10. **Keep API keys on the server.** A key in a browser bundle is public. See [API key good practices](/developers/how-to/api-key-good-practices).

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

24 tickers are live on Robinhood Chain, Hedera and Stellar, with one vault token per ticker on Sonic. The full list is in [Live tickers and networks](#live-tickers), and every address is in [Mainnet deployments](/developers/deployments/mainnet#robinhood-tokenized-equities).

#### 2. Is every Hedera stock token backed 1:1?

Yes. Every stock token on Hedera is backed 1:1 by the real Robinhood token, locked in the SODAX contract on Robinhood Chain. There is no separately published proof of reserves, but anyone can verify the backing on-chain. Compare the Hedera supply held outside the SODAX Hedera contract (`0x0df73542cC68bDC01b361d231c60F726B0e0bC05`) with what that same address holds of each token on Robinhood Chain. [Verify backing on-chain](#verify-backing) has a script that does this.

#### 3. Who controls the admin and supply key, and what stops unbacked minting?

SODAX controls the admin and supply key. New stock tokens on Hedera are only issued against Robinhood tokens locked in the SODAX contract on Robinhood Chain, and anyone can check that backing on-chain (see question 2 and [Verify backing on-chain](#verify-backing)).

#### 4. What is the path back to Robinhood Chain for Hedera holders?

Because every token is backed 1:1, anyone holding a stock on Hedera can bridge it back to Robinhood Chain at any time and receive the real Robinhood token. Builders can offer that bridge in their own app with SODAX. See the [Bridge path](#bridge-path).

#### 5. What happens if the SODAX vault on Robinhood Chain were frozen?

SODAX runs sanctions screening across its infrastructure and is verified on the platforms that require it. Robinhood makes these assets available through liquidity providers, and SODAX sources the assets from them. A freeze would hurt Robinhood's own chain and product, so SODAX considers it very unlikely.

#### 6. What fees apply?

A stock swap pays the same fees as any SODAX swap: the 0.1% solver fee, plus your own partner fee if you set one. See [Monetize SDK](/developers/how-to/monetize_sdk). Bridges can carry a partner fee too, which you can preview with `sodax.bridge.getFee`. The stock vault tokens on Sonic currently charge no deposit or withdrawal fee. Fees can be configured later, so treat zero as the current setting, not a permanent promise.

#### 7. Are there limits on how much can move?

Yes. `sodax.bridge.getBridgeableAmount` returns the most that can be bridged right now, and stock-to-stock swaps only quote above a small minimum size.

## Related

<CardGroup cols={2}>
  <Card title="Make a swap (SDK)" icon="repeat" href="/developers/how-to/how_to_make_a_swap">
    Every step of an SDK swap, with allowance, status and error handling.
  </Card>
  <Card title="Bridge (SDK)" icon="bridge-suspension" href="/developers/packages/foundation/sdk/functional-modules/bridge">
    Every `sodax.bridge` method, error code and type.
  </Card>
  <Card title="Mainnet deployments" icon="globe" href="/developers/deployments/mainnet#robinhood-tokenized-equities">
    Every stock token, hub asset and vault address.
  </Card>
  <Card title="Vault Token" icon="vault" href="/developers/technical-overview/vault-token">
    How one token on Sonic wraps the same asset from many networks.
  </Card>
</CardGroup>
