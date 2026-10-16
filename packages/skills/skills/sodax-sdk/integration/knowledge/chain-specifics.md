# Chain specifics — chain quirks

EVM chains mostly work uniformly through `IEvmWalletProvider`, with **one** native-value exception (Hedera, below) and one settlement exception: Monad is EVM for wallets but settles through the MPC relay (see the non-EVM table). Non-EVM chains have more particularities you need to handle. This file documents each chain family's quirks.

## Section index

EVM:

0. [Hedera HBAR msg.value scaling](#0-hedera-hbar-msgvalue-scaling) — `HEDERA_MAINNET`. The only EVM-family quirk: native deposits scale `msg.value` by 10^10. Handled automatically by the SDK.

Non-EVM:

1. [Stellar trustline](#1-stellar-trustline) — `STELLAR_MAINNET`. Required before receiving any non-XLM asset.
2. [Bitcoin PSBT and Bound Exchange](#2-bitcoin-psbt-and-radfi) — `BITCOIN_MAINNET`. PSBT signing; trading wallet; Bound Exchange auth/session.
3. [Solana PDA derivation](#3-solana-pda-derivation) — `SOLANA_MAINNET`. Deterministic addresses; one-time setup utilities.
4. [ICON Hana wallet](#4-icon-hana-wallet) — `ICON_MAINNET`. Low-level Hana-extension helpers; chain key string vs numeric ID.
5. [NEAR connector discovery](#5-near-connector-discovery) — `NEAR_MAINNET`. Account-id semantics; multiple wallet variants.

---

## 0. Hedera HBAR msg.value scaling

**Quirk:** HBAR is tracked with **8 decimals** in SODAX spoke accounting, but Hedera's EVM layer treats native `msg.value` as **18 decimals**. So for a native-HBAR deposit the on-chain `msg.value` must be the 8-decimal amount multiplied by **10^10**, even though the asset-manager `transfer` argument stays in 8 decimals.

### How v2 handles it

**Nothing to do — it's automatic.** `EvmSpokeService` scales `msg.value` internally when the source chain is `HEDERA_MAINNET` and the deposit is native; every other EVM chain passes the amount through unchanged. You always pass the canonical 8-decimal HBAR amount to the deposit / swap / bridge call, exactly as you would any other chain's native amount — the spoke service applies the 10^10 factor only to the transaction's `value` field.

### Pitfall

Do **not** pre-scale the amount yourself. Pass the plain 8-decimal HBAR amount; multiplying by 10^10 before handing it to the SDK double-scales and overpays. The scaling applies only to the native token (HBAR) — HTS / ERC-20 token deposits on Hedera carry `value: 0` and are unaffected.

---

## 1. Stellar trustline

**Requirement:** before a Stellar account can hold or receive a non-XLM asset, it must establish a trustline to the asset issuer. SODAX's bridge / swap / money-market deliver stablecoin assets to Stellar — the destination Stellar account must have an active trustline for the asset, or the operation fails.

### How v2 handles it

`BridgeService` and other feature services delegate Stellar trustline / allowance handling to the Stellar spoke service internally — there is **no** public `checkStellarTrustline` / `requestStellarTrustline` method on `BridgeService`. When you call `sodax.bridge.approve({ params, raw: false, walletProvider })` with a Stellar `walletProvider`, the spoke service handles the trustline operation for you.

For direct trustline interaction outside the standard `approve` flow, reach for the Stellar spoke service:

```ts
import { ChainKeys, type StellarSpokeService } from '@sodax/sdk';

const stellarSpoke = sodax.spoke.getSpokeService(ChainKeys.STELLAR_MAINNET) as StellarSpokeService;
// Use the spoke service's typed methods for Stellar-specific operations.
```

### When to gate

Before any swap / bridge / money-market operation that **delivers** a non-XLM asset to a Stellar destination, the destination wallet must already trust the asset. Failed trustline checks surface as `VALIDATION_FAILED` errors; use `error.context.reason` to disambiguate. The standard pattern for app code is to call `sodax.bridge.approve(...)` (or the matching feature's approve) on the Stellar wallet first, which establishes the trustline as a side effect.

### Pitfall

Stellar accounts that have never held the asset have **no** trustline — receiving will fail. The error surfaces as `VALIDATION_FAILED` with `context.reason: 'trustlineMissing'` (or similar). Treat the missing-trustline state as a one-time setup step gated by the standard `approve` flow.

---

## 2. Bitcoin PSBT and Bound Exchange

Bitcoin support uses Partially Signed Bitcoin Transactions (PSBT) — a different model than EVM tx signing. The wallet provider (`BTCWalletProvider`) handles PSBT construction and signing internally.

### Address types

```ts
type BtcAddressType = 'P2PKH' | 'P2SH' | 'P2WPKH' | 'P2TR';
```

`BTCWalletProvider` config takes an `addressType`. `'P2WPKH'` (native SegWit) is the modern default; `'P2TR'` (Taproot) is supported but may have lower compatibility with some on-chain logic.

### Bound Exchange (auth + trading wallet)

SODAX uses the Bound Exchange infrastructure for Bitcoin. Each user gets a derived "trading wallet" funded from their main BTC address. Operations consume UTXOs from the trading wallet rather than directly from the user's main address.

The Bound Exchange provider is owned by `BitcoinSpokeService`. Reach it via the spoke router:

```ts
import { ChainKeys, type BitcoinSpokeService } from '@sodax/sdk';

const btcSpoke = sodax.spoke.getSpokeService(ChainKeys.BITCOIN_MAINNET) as BitcoinSpokeService;
const radfi = btcSpoke.radfi;   // RadfiProvider instance
```

Most consumer flows don't need to touch `radfi` directly — `sodax.bridge.bridge(...)`, `sodax.swaps.createIntent(...)`, etc. handle the Bound Exchange auth + trading-wallet routing internally on the Bitcoin path. For explicit lifecycle management:

```ts
// Authenticate against Bound Exchange (the wallet signs an auth message):
await radfi.authenticateWithWallet(/* args per RadfiProvider source */);

// Fetch the trading wallet for an address (creating it if needed):
const tradingWallet = await radfi.getTradingWallet(personalAddress);

// Read the trading wallet's BTC + token balances:
const balance = await radfi.getBalance(tradingWallet.address);

// Check whether a trading wallet exists without provisioning one:
const exists = await radfi.checkIfTradingWalletExists(personalAddress);
```

**Server-side / raw flows (no interactive sign-in).** A backend that builds raw Bitcoin intents can't run the BIP322 login, so seed a pre-provisioned Bound token instead of authenticating. `RadfiProvider` honors three injection points: `new Sodax({ ... })` with `radfi.accessToken` (and optional `refreshToken`) in the Bitcoin chain config (the constructor seeds them), `radfi.setRadfiAccessToken(token)` at runtime, or a per-action `extras.bound.accessToken` on `createIntent` (the Bitcoin-gated `bound` slot groups Bound/Radfi inputs). If an authenticated Bound call has neither a token nor a configured `apiKey`, `RadfiProvider` throws a legible `RadfiApiError` (the message names the fix: inject via `setRadfiAccessToken` or `new Sodax({ ... })` with `radfi.accessToken`) instead of sending an empty bearer and getting an opaque 403.

**Backend request signing.** Separate from the per-user token above: if Bound authenticates your service itself, pass `radfi.signRequest` to `new Sodax({ ... })`. The SDK calls it once per outbound Bound request and merges the returned headers onto it, so the credential stays in your closure and never on the SDK config:

```ts
import { createHmac } from 'node:crypto';

new Sodax({
  radfi: {
    signRequest: () => {
      const ts = `${Date.now()}`;
      const signature = createHmac('sha256', secretKey).update(`${secretWord}_${ts}`).digest('hex');
      return { 'x-api-signature': `${signature}_${ts}` };
    },
  },
});
```

It receives `{ method, path }`, may be async, and runs on every request (a timestamped signature must not be cached). Its headers merge last, so do not return `Authorization` — that is the per-user token. Server-side only: never ship a credential in a browser bundle.

Other public methods on `RadfiProvider` you may need: `setRadfiAccessToken`, `refreshAccessToken`, `createTradingWallet`, `createWithdrawTransaction`, `requestRadfiSignature`, `getExpiredUtxos`, `buildRenewUtxoTransaction`, `signAndBroadcastRenewUtxo`, `withdrawToUser`, `signAndBroadcastWithdraw`, `getMaxWithdrawable`. Read `RadfiProvider` source for argument shapes — the API surface is broader than typical chain providers.

### Pitfall

`BitcoinSpokeService.radfi` is what feature services use under the hood. Bypassing the feature services and driving Bound Exchange yourself works but is rarely needed — and you have to wire token balances + UTXO state manually. Prefer the standard feature flows unless you specifically need lifecycle control.

---

## 3. Solana PDA derivation

Program Derived Addresses (PDAs) are deterministic Solana addresses derived from a program ID + seeds. SODAX uses PDAs for the user's spoke-side state on Solana.

The SDK derives PDAs internally — consumers don't usually need to do this manually. For advanced use cases (preflight, off-chain state lookups), reach into the Solana spoke service via the router:

```ts
import { ChainKeys, type SolanaSpokeService } from '@sodax/sdk';

const solanaSpoke = sodax.spoke.getSpokeService(ChainKeys.SOLANA_MAINNET) as SolanaSpokeService;
// Use the spoke service's typed methods for any PDA-related read or write.
```

### `SolanaSpokeService` specifics

- Solana txs are different shape from EVM (multiple instructions per tx; signed once globally).
- `TxReturnType<typeof ChainKeys.SOLANA_MAINNET, false>` is the base58-encoded signature string (not `0x…`).
- `SolanaRawTransaction` is the raw-tx return for `raw: true` — base64-encoded message for downstream signing.

### Pitfall

Solana addresses are base58 PublicKey strings, not `0x…` hex. `GetAddressType<typeof ChainKeys.SOLANA_MAINNET>` resolves to a base58-typed string brand; passing a hex address is a TypeScript error.

---

## 4. ICON Hana wallet

ICON uses the Hana browser-extension wallet for dApp signing. The SDK ships low-level helper functions (file: `HanaWalletConnector.ts`) that wrap the Hana extension's JSON-RPC interface; consumers compose them into an `IIconWalletProvider` implementation.

```ts
import { requestAddress, requestSigning, requestJsonRpc } from '@sodax/sdk';

const result = await requestAddress();   // returns Result<IconAddress>
if (result.ok) {
  const address = result.value;          // 'hx…'
}
```

ICON spoke calls require an `IIconWalletProvider`. Implementations either compose the helper functions above into a class your app owns, or use the reference implementation that ships in `@sodax/wallet-sdk-core` (separate package, install separately).

### `ChainKeys.ICON_MAINNET` is a string `'0x1.icon'`

The ICON chain key is the **string** `'0x1.icon'`, not the legacy numeric chain id `0x1`. This trips up code that did `Number(chainId)` to coerce — that returns `NaN` for `'0x1.icon'`.

```ts
ChainKeys.ICON_MAINNET === '0x1.icon';            // true
Number(ChainKeys.ICON_MAINNET);                   // NaN
chainKey === ChainKeys.ICON_MAINNET;              // works
```

### Address types

- `hx…` — externally-owned account (user wallet).
- `cx…` — contract account.

`GetAddressType<typeof ChainKeys.ICON_MAINNET>` accepts both via a string brand.

### Injective (similar pattern)

Injective is a separate chain family but uses a similar wallet-extension model. Wallet helper: `Injective20Token` (in `@sodax/sdk`'s injective utilities). `IInjectiveWalletProvider` implementations can use Keplr, Leap, or other Cosmos-ecosystem wallets.

---

## 5. NEAR connector discovery

NEAR has multiple wallet variants (NEAR Wallet, MyNearWallet, Meteor, Sender, …). NEAR spoke calls require an `INearWalletProvider`. The interface is exported from `@sodax/sdk`; consumers supply an object satisfying it. A reference implementation ships in `@sodax/wallet-sdk-core` (separate package — install separately); browser-side connector discovery for the multiple NEAR wallet variants happens there, not in `@sodax/sdk` itself.

### Account ID semantics

NEAR addresses come in two forms:

- **Named accounts** — `alice.near`, `mybiz.near`. Human-readable.
- **Implicit accounts** — 64-character hex strings.

Both are valid. `GetAddressType<typeof ChainKeys.NEAR_MAINNET>` accepts both via a string type.

### Pitfall

`NearWalletProvider` requires the `accountId` field at construction (alongside `privateKey`). Unlike EVM, NEAR can't derive an account from a key alone — keys are scoped to accounts.

### Receiving tokens: NEP-141 storage registration

Before a NEAR account can **receive** (hold a balance of) a NEP-141 token, it must pay a one-time storage bond on that token contract — delivering to an unregistered account fails. This gates any flow that delivers a token to a user on NEAR: swap output on NEAR, bridge into NEAR, money-market borrow/withdraw to NEAR. (Native NEAR is not a NEP-141 token and needs no registration.)

The NEAR spoke service exposes two methods — reach it via `sodax.spoke.near` or `sodax.spoke.getSpokeService(ChainKeys.NEAR_MAINNET)`:

- `isStorageRegistered(token, accountId): Promise<boolean>` — whether `accountId` can already receive `token`. Returns `true` for the native token (no NEP-141). Read-only; uses the configured NEAR RPC.
- `registerStorage({ token, accountId, walletProvider, deposit?, raw? })` — submits a `storage_deposit` for `accountId`; returns the tx hash (or the unsigned tx when `raw: true`). `deposit` defaults to `NEAR_STORAGE_DEPOSIT` (0.00125 NEAR, exported from `@sodax/sdk`) — override per token if its `storage_balance_bounds.min` differs. Throws for the native token. The recipient's NEAR wallet signs it.

Gate pattern, run before delivering to NEAR:

```ts
// @ai-snippets-skip — illustrative.
const near = sodax.spoke.near;
if (!(await near.isStorageRegistered(token, accountId))) {
  await near.registerStorage({ token, accountId, walletProvider });
}
```

The `sodax-dapp-kit` skill wraps these as the `useNearStorageCheck` / `useRegisterNearStorage` hooks plus a `resolveNearStorageGate` helper (integration mode).

### `ft_transfer_call` attaches 1 yoctoNEAR

Deposits **from** NEAR (`deposit()` / `fillIntent()` on the NEAR spoke service) call the token's `ft_transfer_call`, which per NEP-141 must carry **exactly 1 yoctoNEAR** — the spoke service attaches it automatically. The signer only needs a small NEAR balance to cover gas (the 1 yoctoNEAR is dust). Native-token deposits use a plain `transfer` and aren't subject to this.

---

## Other non-EVM chains

| Chain | Notes |
|---|---|
| **Sui** (`SUI_MAINNET`) | Address: 32-byte `0x…` (different from EVM addresses despite the prefix). Wallet provider `ISuiWalletProvider` uses `@mysten/sui` under the hood. |
| **Stacks** (`STACKS_MAINNET`) | Address: `SP…` (mainnet) / `ST…` (testnet). Uses `@stacks/transactions` for tx construction. |
| **Injective** (`INJECTIVE_MAINNET`) | Cosmos-ecosystem chain. Address: `inj1…`. Wallet provider uses `@injectivelabs/sdk-ts`. |
| **Tron** (`TRON_MAINNET`) | Address: base58 `T…`. Settles through the **MPC relay**, not the intent relay — a deposit is a transfer to the shared reserve with a payload-hash memo spliced into the raw transaction, and the reserve address comes from the relay per call rather than being fixed. Withdraw auth is scheme 1: `ITronWalletProvider.signMessage` wraps the payload TIP-191 style, and the signer is recovered from the secp256k1 signature. `estimateGas` returns `{ energy, bandwidth }` rather than a single number. |
| **XRP Ledger** (`XRP_MAINNET`) | Address: classic `r…`. Settles through the **MPC relay**, not the intent relay — a deposit is a Payment to the shared reserve carrying a payload-hash memo, and the reserve address comes from the relay per call rather than being fixed. Withdraw auth is scheme 3: `IXrpWalletProvider.signMessage` returns a RAW ed25519 signature and `getPublicKey` the `0xED`-prefixed key, which is submitted alongside because ed25519 cannot recover its signer. An **ed25519 account is required** — a secp256k1 XRPL account can deposit and then never withdraw. A non-XRP (IOU) token is identified by (currency, issuer), so the token's `address` is the ISSUER, and the reserve must already hold a trustline for it. A **destination** must also be able to receive: the account must exist, and for an IOU hold a trustline to the issuer with room for the amount — the relay fails a release otherwise, after the hub has burned the funds. Money-market withdraw/borrow reject such a destination with `VALIDATION_FAILED`; check ahead with `sodax.spoke.xrp.checkDestination({ address, token, amount })`. |
| **Monad** (`MONAD_MAINNET`) | EVM for wallets and addresses (`IEvmWalletProvider`, wagmi), but it has **no spoke contracts**: it settles through the **MPC relay** in **address mode**. A deposit is a plain transfer (native MON, or an ERC-20 `transfer`) to a deposit address the relay derives for that one payload and then sweeps — no approval step. Withdraw auth is scheme 0: EIP-191 `personal_sign` over the raw message hash, so the EVM wallet provider must implement the optional `signMessage`. MON has no vault; money market lists USDC only. |

Each has its own `I*WalletProvider` interface with chain-specific signing methods. The `chainType` discriminant on every `I*WalletProvider` instance lets you narrow at runtime without `instanceof`.

---

## Cross-references

- `WalletProviderSlot` and chain narrowing: [`architecture.md`](architecture.md) §§ 5, 6.
- Per-chain wallet provider interfaces: [`reference/`](reference/) § 2.
- Cast-at-boundary pattern for chain-narrowed providers: [`recipes/`](recipes/) § 5.
