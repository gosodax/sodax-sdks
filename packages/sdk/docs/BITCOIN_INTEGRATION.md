# Bitcoin Integration

### Why Bitcoin is different

Bitcoin's UTXO model and \~10-minute block time make it behave very differently from account-based chains like EVM. A naive integration would require a fresh on-chain Bitcoin transaction for every swap — slow (10+ minutes per operation) and expensive (miner fees per swap). To deliver an EVM-like UX, SODAX routes every Bitcoin operation through a per-user **trading wallet**: a 2-of-2 multisig the user controls jointly with a transaction-signing partner.

The trading wallet amortizes Bitcoin's settlement cost. Users sign in once (BIP322 signature), fund the trading wallet once (\~10-minute on-chain BTC tx), and from then on every swap or bridge executes immediately on the hub chain without waiting for new Bitcoin block confirmations. The multisig commitment is what enables this: because the partner co-signs every outgoing transaction, the SDK can trust the deposit signal before the on-chain BTC transaction confirms — the user retains full custody (the partner cannot move funds alone), but settlement on the hub is decoupled from Bitcoin's block time.

The trade-off is the one-time setup (sign in + fund) and a custody disclosure to end-users (the partner is one of two multisig keys). Once that's done, the dApp UX matches any other spoke chain.

The transaction-signing partner is [**Bound Exchange**](https://bound.exchange) (formerly Radfi). SDK hook and config names still use the `Radfi*` prefix for API-compatibility (`useRadfiSession`, `useRadfiWithdraw`, `radfi.apiUrl`, etc.), but the live endpoints now resolve to Bound's own hosts. For the rest of this guide, "the partner" refers to Bound Exchange.

For the generic intent flow, see [SWAPS.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md) and [BRIDGE.md](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/BRIDGE.md). This guide only covers Bitcoin-specific differences.

> **IMPORTANT — Before you start**
>
> * **Local development:** the Bitcoin transaction-signing partner only accepts requests from `http://localhost:1993`. Run your dApp dev server on port `1993` (e.g. `vite --port 1993`). Other localhost ports are rejected at the API layer.
> * **Production release:** before deploying to a production domain, the partner must whitelist your origin. Submit your production URL to the SODAX team ahead of release — non-whitelisted origins are rejected and Bitcoin features will appear broken to end-users.

### Integration Scope

The trading-wallet flow described in this guide is the only Bitcoin path currently supported end-to-end by the SDK frontend layer (`@sodax/dapp-kit`, `@sodax/wallet-sdk-react`).

A second flow — **direct deposit** from the user's personal wallet without an intermediate trading wallet — exists at the SDK core level but does not yet have frontend hooks or production usage. In that flow, every swap requires its own on-chain Bitcoin transaction and a fresh \~10-minute block confirmation, with miner fees paid each time.

**For builders evaluating Bitcoin today:** only the trading-wallet flow is production-ready. Plan against it; the direct-deposit path will be additive when released and will not break existing integrations.

### Prerequisites

* An app already using `@sodax/sdk`, `@sodax/dapp-kit`, and `@sodax/wallet-sdk-react`
* React Query installed and `QueryClientProvider` mounted
* A Bitcoin wallet extension installed (Unisat, Xverse, or OKX)

### Step 1: Enable Bitcoin in your wallet provider

Add `BITCOIN: {}` to `SodaxWalletProvider`. Defaults already point at production endpoints — no API key, no contract addresses, no per-dApp registration.

```tsx
import { SodaxProvider } from "@sodax/dapp-kit";
import { SodaxWalletProvider } from "@sodax/wallet-sdk-react";

<SodaxProvider>
  <QueryClientProvider client={queryClient}>
    <SodaxWalletProvider config={{ BITCOIN: {} }}>
      {children}
    </SodaxWalletProvider>
  </QueryClientProvider>
</SodaxProvider>
```

### Bound hosts

Bound serves its API from four hosts. The SDK routes three of them by path family; UMS is called
directly on `umsUrl` and is never routed. You do not need to configure any of this — the packaged
defaults are correct:

| Path family | Host |
| --- | --- |
| `/sodax/*` | `svc.bound.exchange` |
| `/auth/*`, `/wallets/*` | `auth.bound.exchange` |
| `/transactions/*` | `api.radfi.co` |
| `/wallets/balance`, `/utxos` | `api.ums.bound.exchange` |

**`api.radfi.co` is a different registrable domain.** If your app sets a Content-Security-Policy
`connect-src`, or runs behind an egress allowlist, allow it explicitly — a rule written as
`https://*.bound.exchange` will block BTC withdrawal and UTXO renewal, and a rule naming
`https://api.bound.exchange` will block everything.

To point the SDK somewhere else — a proxy, or a test environment — set `apiUrl` on the SDK
config (**not** on the wallet provider):

```tsx
new Sodax({
  chains: {
    [ChainKeys.BITCOIN_MAINNET]: {
      radfi: { apiUrl: "https://my-proxy.internal/bound" },
    },
  },
});
```

**Setting `apiUrl` to a host of your own sends all three routed families there** — `/sodax/*`,
`/auth/*` + `/wallets/*`, and `/transactions/*`. The split above is registered against Bound's own
service host, so it applies only while `apiUrl` is that host. That is deliberate: it keeps a
single-host setup working, and it makes it impossible to half-migrate and have auth traffic
silently land in a different environment from the rest. To keep the split while changing one
family, set that family's host explicitly with `authUrl` or `transactionsUrl`.

**`api.bound.exchange` is refused.** This SDK routes to the split hosts, so a `radfi.apiUrl`,
`authUrl` or `transactionsUrl` still naming the retired host throws at construction with the
replacement for that field. Remove the setting to take the packaged default, or point it at the
new host. Migrating from an older SDK:

```ts
// before — retired, now throws
radfi: { apiUrl: 'https://api.bound.exchange/api' }

// after — either of these
radfi: { }                                              // packaged default
radfi: { apiUrl: 'https://svc.bound.exchange/api' }     // explicit
```

Moving to a test environment stays two lines, and both are needed — `apiUrl` does not carry UMS:

```ts
radfi: {
  apiUrl: 'https://staging.api.bound.exchange/api',
  umsUrl: 'https://staging.api.ums.bound.exchange/api',
}
```

**UMS is not routed by `apiUrl`.** `/wallets/balance` and `/utxos` always use `umsUrl`, so a
proxy or test environment that must capture *all* Bound traffic has to override `umsUrl` too.

To override RPC endpoints (canary, signet), pass them under `BITCOIN.chains[ChainKeys.BITCOIN_MAINNET]`:

```tsx
import { ChainKeys } from "@sodax/types";

<SodaxWalletProvider
  config={{
    BITCOIN: {
      chains: {
        [ChainKeys.BITCOIN_MAINNET]: {
          rpcUrl: "https://mempool.space/api",
        },
      },
    },
  }}
>
  {children}
</SodaxWalletProvider>
```

That block used to accept `radfiApiUrl` and `radfiUmsUrl` as well. Both are removed: nothing
ever read them, so setting one silently did nothing. If they fail to compile after upgrading,
delete them — the Bound hosts they looked like they configured are the `radfi` block on the SDK
config shown above, which is where they have always actually lived.

### Step 2: Connect a Bitcoin wallet

`useBitcoinXConnectors()` returns the wallets installed in the browser. Pass one to `useXConnect`:

```tsx
import { useBitcoinXConnectors } from "@sodax/wallet-sdk-react/xchains/bitcoin";
import { useXConnect } from "@sodax/wallet-sdk-react";

const connectors = useBitcoinXConnectors();
const { mutateAsync: connect } = useXConnect();

await connect(connectors[0]);   // user picks one in your UI
```

After connect, get the wallet provider:

```tsx
import { useWalletProvider } from "@sodax/wallet-sdk-react";
import { ChainKeys } from "@sodax/types";

const walletProvider = useWalletProvider(ChainKeys.BITCOIN_MAINNET);
```

### Step 3: Sign in and provision the trading wallet

The user signs a BIP322 (or ECDSA) message proving control of their personal Bitcoin address. The server provisions a multisig trading wallet on first sign-in and returns its address. `useRadfiSession` handles the signature, JWT lifecycle, and `localStorage` persistence:

```tsx
import { useRadfiSession } from "@sodax/dapp-kit";

const { isAuthed, tradingAddress, login, isLoginPending } =
  useRadfiSession(walletProvider);

if (!isAuthed) {
  await login();              // user signs in their wallet
}

// tradingAddress is now defined
```

The session is silently refreshed every 5 minutes. After 7 days of inactivity the user must sign in again.

### Step 4: Fund the trading wallet

The user sends BTC from their personal wallet to the trading-wallet address. This is a normal on-chain BTC transaction — wallet selects UTXOs, computes change, and pays the network fee.

```tsx
import { useFundTradingWallet } from "@sodax/dapp-kit";
import { parseUnits } from "viem";

const { mutateAsync: fund } = useFundTradingWallet();

const txId = await fund({
  amount: parseUnits("0.001", 8),   // 100,000 sats
  walletProvider,
});
```

**Confirmation takes \~10 minutes.** Until confirmed, the deposit appears in `tradingBalance.externalPendingSatoshi`. Surface this pending state in your UI so users do not double-fund.

This is a **one-time wait per top-up** — once the trading wallet has a confirmed balance, subsequent swaps and bridges execute immediately without further Bitcoin block confirmations.

### Step 5: Build the readiness gate

Before submitting any swap or bridge, verify the user is ready. Compose three hooks into a boolean:

```tsx
import {
  useRadfiSession,
  useTradingWalletBalance,
  useExpiredUtxos,
} from "@sodax/dapp-kit";

const { isAuthed, tradingAddress } = useRadfiSession(walletProvider);
const { data: tradingBalance } = useTradingWalletBalance({
  params: { walletProvider, tradingAddress },
});
const { data: expiredUtxos } = useExpiredUtxos({
  params: { walletProvider, tradingAddress },
});

const isReady =
  isAuthed &&
  !!tradingAddress &&
  (isDestination ||
    ((tradingBalance?.btcSatoshi ?? 0n) > 0n &&
      (!expiredUtxos || expiredUtxos.length === 0)));
```

| Unmet condition           | User action | Hook to invoke                        |
| ------------------------- | ----------- | ------------------------------------- |
| `!isAuthed`               | Sign In     | `useRadfiSession.login` (Step 3)      |
| `tradingBalance === 0n`   | Top Up      | `useFundTradingWallet` (Step 4)       |
| `expiredUtxos.length > 0` | Renew UTXOs | `useRenewUtxos` (see Auxiliary Flows) |

Destination-side readiness (Bitcoin is being received) only requires `isAuthed && tradingAddress`. The trading wallet does not need a balance to receive.

### Step 6: Build `CreateIntentParams` with Bitcoin-specific overrides

Three fields differ from the standard intent params when source or destination is Bitcoin:

```tsx
import { loadRadfiSession } from "@sodax/dapp-kit";
import { ChainKeys, type CreateIntentParams } from "@sodax/sdk";

const DUST_LIMIT = 546n;

const srcAddress = await sourceWalletProvider.getWalletAddress();   // personal address

const rawMinOutput = (quote.quoted_amount * (100n - slippageBps)) / 100n;

const params = {
  inputToken: src.token.address,
  outputToken: dst.token.address,
  inputAmount: parseUnits(amount, src.token.decimals),

  // dstAddress: trading wallet when destination is Bitcoin, personal otherwise
  dstAddress:
    dst.chain === ChainKeys.BITCOIN_MAINNET
      ? loadRadfiSession(destAccount.address)?.tradingAddress
      : destAccount.address,

  // srcAddress: personal wallet (the SDK derives the trading wallet internally)
  srcAddress,

  // minOutputAmount: clamp to 546 sats when destination is BTC
  minOutputAmount:
    dst.chain === ChainKeys.BITCOIN_MAINNET && dst.token.symbol === "BTC"
      ? rawMinOutput > DUST_LIMIT ? rawMinOutput : DUST_LIMIT
      : rawMinOutput,

  srcChainKey: src.chain,
  dstChainKey: dst.chain,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 5),
  allowPartialFill: false,
  solver: "0x0000000000000000000000000000000000000000",
  data: "0x",
} satisfies CreateIntentParams;
```

**Three rules to remember:**

1. `srcAddress` = personal wallet (not trading). The SDK derives the trading address internally for hub wallet derivation.
2. `dstAddress` = trading wallet (not personal) when destination is Bitcoin. Forgetting this is the most common Bitcoin integration bug — the swap submits successfully but settles to an address the user cannot interpret.
3. `minOutputAmount` ≥ 546 satoshis when destination is BTC. The SDK throws an invariant otherwise.

### Step 7: Submit the swap

Use `sodax.swaps.swap()` (or the equivalent bridge call) — same as any other spoke chain:

```tsx
const swapResult = await sodax.swaps.swap({
  params,
  walletProvider,   // IBitcoinWalletProvider — the personal-wallet provider
});

if (!swapResult.ok) {
  // handle error — see SWAPS.md Error Handling
  return;
}

const { solverExecutionResponse, intent, intentDeliveryInfo } = swapResult.value;
```

**Constraints when source is Bitcoin:**

* `walletProvider` must be `IBitcoinWalletProvider` — the SDK throws `Invalid wallet provider for chain key` otherwise.
* Raw mode (`raw: true`) is **not supported**. Only `raw: false` execution. Server-side flows that emit raw transactions cannot use Bitcoin as source.
* The session access token is auto-refreshed inside `swap` / `createIntent` — no manual token handling needed.

### Auxiliary Flows

These are not part of the swap path but commonly required.

#### Withdraw from the trading wallet

PSBT round-trip: server builds, user signs, server co-signs and broadcasts.

```tsx
import { useRadfiWithdraw } from "@sodax/dapp-kit";

const { mutateAsync: withdraw } = useRadfiWithdraw();

const result = await withdraw({
  amount: "50000",              // sats as string
  tokenId: "0:0",               // native BTC
  withdrawTo: "bc1q...",        // any valid BTC address
  walletProvider,               // IBitcoinWalletProvider
});
// { txId, fee }
```

For a "Max" button that nets out fees:

```tsx
import { useSodaxContext, loadRadfiSession } from "@sodax/dapp-kit";

const { sodax } = useSodaxContext();
const session = loadRadfiSession(walletAddress);

const max = await sodax.spoke.bitcoin.radfi.getMaxWithdrawable(
  { userAddress: walletAddress, amount, tokenId: "0:0", withdrawTo },
  session.accessToken,
);
// { maxSatsAmt, feeRate, fee }
```

#### Renew expired UTXOs

Trading-wallet UTXOs have a time-bounded script. `useExpiredUtxos` polls every 60s and includes UTXOs within two weeks of expiry:

```tsx
import { useExpiredUtxos, useRenewUtxos } from "@sodax/dapp-kit";

const { data: expiredUtxos } = useExpiredUtxos({
  params: { walletProvider, tradingAddress },
});
const { mutateAsync: renew } = useRenewUtxos();

if (expiredUtxos?.length) {
  await renew({
    txIdVouts: expiredUtxos.map((u) => u.txidVout ?? `${u.txid}:${u.vout}`),
    walletProvider,
  });
}
```

### Special Considerations

* **Custody.** Funds in the trading wallet sit in a 2-of-2 multisig: the user holds one key, the Bitcoin transaction-signing partner holds the other. The partner's co-signing authority on each trading wallet expires three months after creation. Disclose this in your UI copy.
* **No `approve()` step.** Bitcoin uses a UTXO model — `useSwapAllowance` / `useSwapApprove` short-circuit when source is Bitcoin. Hide the approve button in your UI.
* **Chain ID is a string** (`'bitcoin'`, not numeric). Any chain-id branching, switch statement, or dictionary key in your code must handle this.
* **Wallet switching.** `useRadfiSession` resets `isAuthed` immediately when `walletProvider` changes. Trading-wallet addresses persist in `localStorage` keyed by personal wallet address — they do not transfer across wallets.
* **Address types.** P2WPKH and P2TR sign with BIP322; P2SH and P2PKH sign with ECDSA. The SDK auto-dispatches; builders do not need to choose. Xverse can switch between Taproot and Segwit at runtime via `setAddressPurpose()` (requires reconnect).
* **API availability.** Trading-wallet operations (sign in, withdraw, UTXO renewal) depend on the partner's API. Personal-wallet → trading-wallet top-up via `walletProvider.sendBitcoin` works without the API. Plan a degraded-state UI for outages.

### Reference Implementation

A complete working example is in [`apps/demo/src/components/swaps/SwapCard.tsx`](https://github.com/icon-project/sodax-sdks/blob/main/apps/demo/src/components/swaps/SwapCard.tsx) — it composes the readiness gate, applies the three intent-param overrides, and gates the swap button. The demo's default dev script binds port 3000 (`pnpm dev:demo`); for end-to-end Bitcoin testing against the partner API, start it on the whitelisted port instead — e.g. `pnpm --filter sodax-demo-v2 exec vite --port 1993 --host` (see the IMPORTANT note at the top of this guide).


---

# Agent Instructions: Querying This Documentation

If you need additional information that is not directly available in this page, you can query the documentation dynamically by asking a question.

Perform an HTTP GET request on the current page URL with the `ask` query parameter:

```
GET https://docs.sodax.com/developers/how-to/bitcoin-integration?ask=<question>
```

The question should be specific, self-contained, and written in natural language.
The response will contain a direct answer to the question and relevant excerpts and sources from the documentation.

Use this mechanism when the answer is not explicitly present in the current page, you need clarification or additional context, or you want to retrieve related documentation sections.
