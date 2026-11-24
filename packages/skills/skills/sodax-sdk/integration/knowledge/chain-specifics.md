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
6. [Tron (MPC relay)](#6-tron-mpc-relay) — `TRON_MAINNET`. Settles through the MPC relay, as a source and as a destination.

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

**Bound hosts.** Bound serves its API from three hosts and the SDK routes per path family: `/sodax/*` on `svc.bound.exchange`, `/auth/*` + `/wallets/*` on `auth.bound.exchange`, `/transactions/*` on `api.radfi.co`, and `/wallets/balance` + `/utxos` on `api.ums.bound.exchange`. The packaged defaults are correct, so no configuration is needed. `api.bound.exchange` is retired and **refused**: a `radfi.apiUrl`/`authUrl`/`transactionsUrl` still naming it throws at construction, naming the replacement for that field. Two things to know: `api.radfi.co` is a **different registrable domain**, so a Content-Security-Policy `connect-src` or egress allowlist written as `https://*.bound.exchange` will block BTC withdrawal and UTXO renewal; and setting `radfi.apiUrl` yourself sends the **three routed** families to that host (deliberate — it keeps a single-host or proxy setup working and makes a half-migration impossible). To keep the split while moving one family, set `radfi.authUrl` or `radfi.transactionsUrl` explicitly. UMS is not routed by `apiUrl`: `/wallets/balance` and `/utxos` always use `radfi.umsUrl`, so a proxy that must capture all Bound traffic has to override that too.

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

It receives `{ method, path, baseUrl }` — `baseUrl` is the resolved Bound host for that call, so a signer holding a per-origin credential can branch on it. It may be async, and runs on every routed request (a timestamped signature must not be cached); UMS calls (`/wallets/balance`, `/utxos`) bypass it and go out unsigned. Its headers merge last, so do not return `Authorization` — that is the per-user token. Server-side only: never ship a credential in a browser bundle.

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

Solana addresses are base58 PublicKey strings, not `0x…` hex. `GetAddressType<typeof ChainKeys.SOLANA_MAINNET>` resolves to `SolanaBase58PublicKey`, which is a plain `string` alias — not a brand — so a hex address compiles and then throws inside `new PublicKey(...)` when the spoke service reads the balance or builds the deposit. Pass the base58 address.

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

## 6. Tron (MPC relay)

`TRON_MAINNET`, address base58 `T…`. Tron settles through the **MPC relay**, not the intent relay, so it has no relay packet; branch on `isMpcRelayChainKeyType(chainKey)`. Features that cannot settle through it refuse Tron before signing with `VALIDATION_FAILED`; each feature doc names its refusal.

### From Tron

- A deposit is a memo-tagged transfer, so it needs no approval. A raw deposit settles differently: [`recipes/raw-tx-flow.md`](recipes/raw-tx-flow.md).
- A signed `create*Intent` deposit resolves to its tx hash even when its broadcast or relay notify got no clear answer: settle that hash with `sodax.spoke.settle`, or notify it with `sodax.spoke.submitMpcDeposit`, rather than sending it again.
- A borrow or withdraw has no Tron tx, only the relay's trackingId: it resolves to `{ trackingId, dstChainTxHash }` (`OutboundSettlement<K>`).
- A swap to or from Tron refuses `allowPartialFill`; from Tron it also refuses limit orders and `cancelIntent`, so only its deadline refunds it. The refund is a payout to Tron: release the `txHash` of the intent record's `intent-cancelled` event, e.g. with `sodax.spoke.settleHubRelease`.

### To Tron

- A payout arrives less the relay's release fee, which the SDK does not quote. Before signing, the SDK refuses a payout at or below [`MpcRelayPayoutMinimums`](https://github.com/gosodax/sodax-sdks/blob/main/packages/types/src/chains/chains.ts) with `VALIDATION_FAILED` and `context.reason: 'mpc-payout-below-minimum'`. Pre-check with `getUnmetMpcPayoutMinimum({ token, amount })`.
- Encode a Tron recipient with `encodeRecipient`, not `encodeAddress`.
- The relay does not watch the hub: a payout is released only once its hub tx is notified. `bridge`, `borrow`, `withdraw` and DEX `withdraw` do this. For a solved intent (a swap, a vault withdraw), the solver notifies its fill; `sodax.swaps.waitForIntentDelivery` waits for the payout. A caller driving `create*Intent` or raw txs passes `dstChainKey` to `sodax.spoke.settle`, or releases the hub tx with `sodax.spoke.submitHubRelease` / `settleHubRelease`. From Tron to another spoke, `sodax.spoke.submitHubDelivery(hubTxHash)` relays the hub mint without waiting.
- Withdraw recovery. If `borrow` or `withdraw` returns `INTENT_CREATION_FAILED` with `error.context.trackingId`, read the original withdrawal with `sodax.spoke.getMpcRelayWithdrawal({ chainKey, trackingId })`. Polling only observes the MPC relay record. To drive settlement, call `sodax.spoke.settle({ chainKey, tx: trackingId, direction: 'outbound', dstChainKey, relayData })`. Use the original payout `dstChainKey` and `relayData` from the error context for a feature call, or from the original intent for a raw call. Keep tracking the original ID if a replay is rejected. Do not start another borrow or withdraw while the original outcome is unknown. A 429 on the SDK's own first submission queues nothing. The SDK retries the same authorization up to three total attempts. If all three replies are 429, it reports `withdraw rate limit retries exhausted; nothing was queued` without a tracking ID, and a fresh feature call is safe after backing off.
- Status: for a Tron source, pass `dstChainKey` to `bridge.getDetailedStatus`. Pass Sonic if the bridge ends at the hub. An omitted destination leaves the hub mint non-terminal. To Tron, `bridge.getDetailedStatus` returns the `mpcRelay` arm with `txs.release` once paid, `waitForIntentDelivery` its `mpcRelay` arm (`getSolvedIntentPacket` fails for Tron), and `sodax.spoke.getHubReleaseRecord` reads a release without waiting.

A custom `ITronWalletProvider` must follow its [JSDoc](https://github.com/gosodax/sodax-sdks/blob/main/packages/types/src/tron/tron.ts): `signMessage` signs the hash's hex text, not its raw bytes.

---

## Other non-EVM chains

| Chain | Notes |
|---|---|
| **Sui** (`SUI_MAINNET`) | Address: 32-byte `0x…` (different from EVM addresses despite the prefix). Wallet provider `ISuiWalletProvider` uses `@mysten/sui` under the hood. Reads and submission go over gRPC-web (`grpc_url`, default `https://fullnode.mainnet.sui.io`; `rpc_url` remains a deprecated alias that wins when set) — Mysten's public fullnodes stopped serving JSON-RPC in July 2026, and `sui-node` drops it in October 2026. |
| **Stacks** (`STACKS_MAINNET`) | Address: `SP…` (mainnet) / `ST…` (testnet). Uses `@stacks/transactions` for tx construction. Wallet-signed deposits use post-condition mode `Deny` with exact spend caps (uSTX for native; one cap per fungible token the SIP-10 contract defines), so wallets display the exact spend and anything beyond it aborts on-chain. FT deposits resolve the on-chain asset names via the node's contract-interface endpoint and fail before signing if that lookup fails; `raw: true` skips the lookup — the serialized payload cannot carry post-conditions. |
| **Injective** (`INJECTIVE_MAINNET`) | Cosmos-ecosystem chain. Address: `inj1…`. Wallet provider uses `@injectivelabs/sdk-ts`. |
| **XRP Ledger** (`XRP_MAINNET`) | Address: classic `r…`. Settles through the **MPC relay**, not the intent relay — a deposit is a Payment to the shared reserve carrying a payload-hash memo, and the reserve address comes from the relay per call rather than being fixed. Withdraw auth is scheme 3: `IXrpWalletProvider.signMessage` returns a RAW ed25519 signature and `getPublicKey` the `0xED`-prefixed key, which is submitted alongside because ed25519 cannot recover its signer. An **ed25519 account is required** — a secp256k1 XRPL account could deposit and then never withdraw, so a signed deposit refuses a signer whose key is not ed25519 or is not the account's own (a regular key); a raw deposit leaves that to whoever signs it. `XrpWalletProvider`'s raw-key mode takes the account's family seed (`sEd…`) or its 16 bytes of seed entropy as hex, and refuses anything else; its GemWallet mode refuses to submit unless the wallet is on the XRPL Mainnet (not a test network or Xahau). A non-XRP (IOU) token is identified by (currency, issuer), so the token's `address` is the ISSUER, and the reserve must already hold a trustline for it. A **destination** must also be able to receive: a missing account is created only by native XRP of at least the base reserve (the relay pays the whole amount and covers the ledger fee); an existing one must not require a destination tag (a release cannot carry one) or Deposit Authorization; and for an IOU it must be the issuer or hold a trustline the issuer has authorized when it requires that, not deep-frozen and with room for the amount, from an issuer that has neither frozen it globally nor charges a transfer fee — otherwise the relay fails or holds the release after the hub has burned the funds. Money-market withdraw/borrow, bridge, swap (including the refund of a swap from XRPL), DEX withdraw, recovery and leverage-yield vault intents reject such a recipient with `VALIDATION_FAILED` and a `context.reason` of `xrpl-<reason>`; check ahead with `sodax.spoke.xrp.checkDestination({ address, token, amount, maxAmount? })`, which the synchronous leverage-yield position builders cannot do for an XRPL `origin`. A swap or leverage-yield vault swap fill can exceed `minOutputAmount`, so an IOU payout is refused unless the trustline has room for twice `minOutputAmount` (`checkDestination`'s `maxAmount`), while a missing account is still judged by `minOutputAmount`. A balance read for an address that has never been funded returns 0. Encode an XRPL address that receives funds with `encodeRecipient` (a 32-byte word: 12 zero bytes, then the AccountID), not `encodeAddress`. Recover inbound using the original Payment hash, whether returned on success, carried as `IndeterminateOutcomeError.txHash` by the spoke, or exposed as `context.srcTxHash` by a feature error. For a swap, wait for the hub mint, notify the solver with that hub hash, then poll by the source hash. Use `sodax.spoke.submitMpcDeposit` to re-notify without waiting. If a GemWallet submission failed with an `xrp-payment` handle on the spoke error's `recovery` or the feature error's `context.recovery`, search a bounded XRP Ledger `account_tx` range around the attempt time for a unique validated, successful Payment matching the sending account, reserve destination, memo and amount. Notify or settle only after identifying the original hash. For an initial search, inspect validated ledgers closed from one minute before to five minutes after `attemptedAtMs`. This limits the search only and cannot prove the Payment failed. If the search ends without a unique match, stop automatic recovery and keep the attempt pending for operator reconciliation. Do not submit another Payment to recover either case. As for Tron, the relay does not watch the hub: a payout to XRPL is released only once its hub tx is notified (`borrow`, `withdraw`, `bridge` and DEX `withdraw` do this; `sodax.spoke.submitHubRelease` and `getHubReleaseRecord` notify and read without waiting), a borrow or withdraw from XRPL resolves to `{ trackingId, dstChainTxHash }`, and swaps to or from XRPL refuse `allowPartialFill`, leverage yield, concentrated liquidity, staking, swap `cancelIntent` and limit orders refuse an XRPL source, and partner auto-swap refuses XRPL as its destination. |
| **Monad** (`MONAD_MAINNET`) | EVM for wallets and addresses (`IEvmWalletProvider`, wagmi), but it has **no spoke contracts**: it settles through the **MPC relay** in **address mode**. A deposit is a plain transfer (native MON, or an ERC-20 `transfer`) to a deposit address the relay derives for that one payload and then sweeps — no approval step. Withdraw auth is scheme 0: EIP-191 `personal_sign` over the raw message hash, so the EVM wallet provider must implement the optional `signMessage`. MON has no vault; money market lists USDC only. Encode a Monad address that receives funds with `encodeRecipient`, which returns the plain lowercase 20-byte address (not the padded word Tron and XRP use) and refuses a mixed-case address with a bad EIP-55 checksum. A deposit is sent with `expectedChainId: 143`, so a wallet on another network refuses it before broadcasting. The SDK refuses an invalid or zero relay deposit address before building the transfer. If broadcast is uncertain, use the signed hash on `IndeterminateOutcomeError.txHash` or the feature error's `context.srcTxHash`. A receipt or notification failure after broadcast also preserves the hash. Wait on the original hash with `sodax.spoke.monad.waitForDeposit`. For swaps, notify the solver with the hub mint hash before polling. If a browser wallet returns an `evm-deposit` handle without a hash, reconcile the original transfer using its transaction details and attempt time, then settle that hash. While its outcome is unresolved, do not submit another transfer. For a lost withdrawal reply, poll the original tracking ID or resume outbound settlement with the original destination and relay data. The SDK backs off on 429 using the same signature and only permits a fresh call after three consecutive 429 replies to its fresh authorization. As for Tron and XRP, the relay does not watch the hub: a payout to Monad is released only once its hub tx is notified (`borrow`, `withdraw`, `bridge` and DEX `withdraw` do this; `sodax.spoke.submitHubRelease` and `getHubReleaseRecord` notify and read without waiting), a borrow or withdraw from Monad resolves to `{ trackingId, dstChainTxHash }`, and swaps to or from Monad refuse `allowPartialFill`, while leverage yield, concentrated liquidity, staking, swap `cancelIntent` and limit orders refuse a Monad source and partner auto-swap refuses Monad as its destination. |
| **TON** (`TON_MAINNET`) | **The SDK address is the 32-byte ed25519 PUBLIC KEY, not a TON address** — the relay identifies TON users by key, because an address (a hash of the wallet's StateInit) cannot be inverted. The key's wallet-v4R2 address is what a raw-key deposit sends from and what a withdrawal pays; a TonConnect wallet of another version (e.g. W5) deposits from its own address, but its withdrawals release to the key's v4R2 address. Settles through the **MPC relay** in memo mode: native TON carries the payload hash as a binary comment, USDT (a jetton) carries it in the transfer's `forward_payload`, attaching 0.2 TON of which 0.1 is forwarded (a 1-nanoton forward bounces the jettons back). The deposit hash is the RESERVE's transaction, found by memo, sender and amount, since TonConnect returns no deposit hash. For jettons the notice must come from the reserve’s wallet for the jetton master. The SDK checks the memo against the target and payload before returning a raw transaction or sending. If sending becomes uncertain or discovery times out, keep the `TonDepositRecovery` handle from the spoke error’s `recovery` or the feature error’s `context.recovery` and leave the attempt pending. Pass the handle to `sodax.spoke.ton.resumeDeposit` to find and notify the original reserve hash without a second send. For swaps, settle that hash to obtain the hub mint hash, call `postExecution` with that hub hash, then poll by source hash. Read balances of a non-v4R2 TonConnect wallet with `accountAddress` (from `getAccountAddress()`). USDT payouts to TON are floored at 3 USDT (`MpcRelayPayoutMinimums`, the solver's release-fee cap); the native TON address has a zero floor. Withdraw auth is scheme 5: `ITonWalletProvider.signMessage` runs TonConnect `signData` over `SODAX withdrawal\nmessage: 0x<hash>` and returns the signature with its envelope (workchain, address hash, domain, timestamp); the relay can require a specific app domain and a signature under 15 minutes old. TON has no vault, so money market lists USDT only. Encode a TON address that receives funds with `encodeRecipient` (the 32-byte account hash of the key's wallet-v4R2 address). Once the reserve tx is found, a deposit whose relay notify fails still resolves to its tx hash so a retry cannot send it twice: `settle` re-notifies it, and a caller that does not settle notifies it with `sodax.spoke.submitMpcDeposit`. As for Tron, XRP and Monad, the relay does not watch the hub: a payout to TON is released only once its hub tx is notified (`borrow`, `withdraw`, `bridge` and DEX `withdraw` do this; `sodax.spoke.submitHubRelease` and `getHubReleaseRecord` notify and read without waiting), a borrow or withdraw from TON resolves to `{ trackingId, dstChainTxHash }`, and swaps to or from TON refuse `allowPartialFill`, while leverage yield, concentrated liquidity, staking, swap `cancelIntent` and limit orders refuse a TON source and partner auto-swap refuses TON as its destination. |
| **Zcash** (`ZCASH_MAINNET`) | **Transparent ZEC only** — ZEC deposits go to the `sodaZECv2` vault (`0xf54339…`, the money market's ZEC reserve); `sodaZEC` keeps the earlier vault. ZEC payouts to Zcash are floored at 0.001 ZEC (`MpcRelayPayoutMinimums`). `reverseEncodeAddress` strips the 12-byte padding of an intent's Zcash address. The SDK address is a mainnet `t1…` P2PKH address; its identity is the 20-byte hash160 of the compressed public key. Settles through the **MPC relay** (relay id 133) in address mode: a deposit pays a t-address the relay derives for that one payload, and the deposit is keyed `133-<txid>-<output index>`. Two wallet shapes: a raw key implements `IZcashWalletProvider.signTransaction` (the SDK selects UTXOs, builds a v5 transaction with the deposit at output 0, verifies the signed bytes and broadcasts), while a browser wallet (Noir Wallet) implements `sendTransfer` (the wallet builds and broadcasts; the SDK then finds the output paying the deposit address). Either way `chains.zcash.rpcUrl` must point at a node with address indexing (`getaddressutxos`, `getaddressbalance`, `getrawtransaction`). Withdraw auth is scheme 6: a `signmessage` (`Zcash Signed Message:\n`) over the text `0x<hash>`, signed by the t-address key. Swaps are staging only; the money market lists ZEC (the sodaZECv2 vault is the reserve; sodaZEC is the legacy, non-reserve vault). Encode a Zcash address that receives funds with `encodeRecipient` (a 32-byte word: 12 zero bytes, then the 20-byte pubkey hash). A deposit is refused before any ZEC moves when no Zcash `rpcUrl` is configured. For raw-key payments, the SDK derives the original ZIP-244 txid before broadcasting. If the outcome is uncertain, use the txid from the spoke error's `txHash` or the feature error's `context.srcTxHash`. Resume with `waitForDeposit` using that same txid. For swaps, notify the solver via `postExecution` with the hub mint hash and poll by source hash. Do not send another payment. For a lost withdrawal response, use the original `trackingId` and relay data. Fresh SDK withdrawals back off on 429 with the same signature and permit a fresh call only after definite failure. A known deposit whose relay notification failed also keeps its original hash. As for Tron, XRP, Monad and TON, the relay does not watch the hub: a payout to Zcash is released only once its hub tx is notified (`borrow`, `withdraw`, swaps and `bridge` do this; `sodax.spoke.submitHubRelease` and `getHubReleaseRecord` notify and read without waiting), and a borrow or withdraw from Zcash resolves to `{ trackingId, dstChainTxHash }`, and swaps to or from Zcash refuse `allowPartialFill`, while leverage yield, concentrated liquidity, staking, swap `cancelIntent` and limit orders refuse a Zcash source and partner auto-swap refuses Zcash as its destination. |
| **Cardano** (`CARDANO_MAINNET`) | **Native ADA only** — the SDK address is a mainnet `addr1…` key-hash payment address (enterprise or base); its identity is the 28-byte blake2b-224 payment key hash. Settles through the **MPC relay** (relay id 1815) in **memo mode**: a deposit is one payment to the shared reserve at output 0, carrying the payload hash as CIP-20 label-674 metadata (64 bare hex characters), and is keyed `1815-<txhash>-0`. A CIP-30 wallet (Lace) signs and submits but does not build transactions, so the SDK builds the deposit from the account's **pure-ADA UTXOs** (outputs holding native tokens are never spent) read from Koios (`chains.cardano.rpcUrl`, default `https://api.koios.rest/api/v1`), and the wallet adds its witness. **Public Koios sends no CORS headers on responses, so a browser app must point `rpcUrl` at a CORS-enabled endpoint or its own proxy.** The SDK refuses a deposit below the reserve output's min-UTXO and a witness set without a valid signature from the account's payment key, both before broadcast, and a relay reserve that is not the configured one. If wallet submission throws and the SDK cannot tell whether it broadcast the deposit, the SDK tries to notify the relay and throws an `IndeterminateOutcomeError` carrying its computed hash as `txHash`. If the wallet instead returns a hash that differs from the one the SDK built, the SDK notifies both and throws with the built hash as `txHash` and the wallet's as `walletTxHash`. In either case, settle `txHash` and do not send the deposit again. An explicit CIP-30 refusal (`{ code: 1, info }`) is rethrown unchanged without notifying the relay (`sodax.spoke.deposit` returns it as `{ ok: false, error }`). Withdraw auth is scheme 7: `ICardanoWalletProvider.signData` over the text `0x<hash>` (66 bytes, signed unhashed), submitted with the wallet's COSE_Sign1 and COSE_Key. A payout to Cardano is the full raw address (29 or 57 bytes) encoded with `encodeRecipient`, not a padded word, and must be **at least 1 ADA**: the contract refuses a smaller release after the hub has burned it, so the SDK refuses with `VALIDATION_FAILED` and `context.reason: 'mpc-payout-below-minimum'` first (`getUnmetMpcPayoutMinimum`). Script, pointer, reward, Byron and testnet addresses are refused. A deposit whose relay notify fails still resolves to its tx hash so a retry cannot pay twice: `settle` re-notifies it, and a caller that does not settle notifies it with `sodax.spoke.submitMpcDeposit`. As for the other MPC chains, the relay does not watch the hub: a payout to Cardano is released only once its hub tx is notified (swaps and `bridge` do this; `sodax.spoke.submitHubRelease` and `getHubReleaseRecord` notify and read without waiting), a borrow or withdraw from Cardano resolves to `{ trackingId, dstChainTxHash }`, and swaps to or from Cardano refuse `allowPartialFill`, while leverage yield, concentrated liquidity, staking, swap `cancelIntent` and limit orders refuse a Cardano source and partner auto-swap refuses Cardano as its destination. ADA is swap-supported in the **staging** solver environment only; there is no money market (sodaADA is not a lending-pool reserve). The SDK refuses a single deposit above 400 ADA, the sodaADA vault's total deposit capacity; read the capacity still free with `sodax.bridge.getBridgeableAmount` before depositing. |

For an `evm-deposit` recovery handle, search the original account's recent transactions on the handle's chain. Bound the search by the recorded attempt time and a caller-set time or block budget. Compare sender, destination, calldata and value. Use the hash only for a unique confirmed match; if the search is inconclusive, preserve the handle and stop. A new deposit does not reuse the old authorization. Start a fresh withdrawal only after a definite failure, such as SDK-fresh rate-limit exhaustion with no tracking ID.


Each has its own `I*WalletProvider` interface with chain-specific signing methods. The `chainType` discriminant on every `I*WalletProvider` instance lets you narrow at runtime without `instanceof`.

---

## Cross-references

- `WalletProviderSlot` and chain narrowing: [`architecture.md`](architecture.md) §§ 5, 6.
- Per-chain wallet provider interfaces: [`reference/`](reference/) § 2.
- Cast-at-boundary pattern for chain-narrowed providers: [`recipes/`](recipes/) § 5.
