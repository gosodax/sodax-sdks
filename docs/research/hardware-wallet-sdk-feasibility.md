# Feasibility Research — Hardware Wallets as an Optional SODAX SDK

**Epic:** [icon-project/sodax-frontend#1348](https://github.com/icon-project/sodax-frontend/issues/1348)
**Status:** Research / draft for SDK-stream review
**Date:** 2026-05-21
**Scope:** Research only. Survey integration paths for Ledger, Trezor, and Keystone; map device signing capability to SODAX's chains; design a standalone add-on SDK; estimate effort and give a go / no-go verdict.

---

## 1. Executive summary

**Verdict: GO — partial / phased.**

SODAX's wallet layer is already extensible enough to absorb hardware-wallet support **without any change to `@sodax/sdk` core**. Every chain slot in `@sodax/wallet-sdk-react` accepts custom `connectors`, and the `XConnector` / `WalletProvider` contracts are abstract classes that a third-party package can subclass. A standalone `@sodax/wallet-hw` add-on is therefore architecturally clean and satisfies the "must not be a hard dependency of core" constraint by construction.

The realistic delivery is **phased**, because device coverage is uneven:

| Phase | Devices × chains | Effort | Notes |
|-------|------------------|--------|-------|
| **Phase 1 (ship first)** | Ledger + Trezor on **all 12 EVM chains** | **S–M** | Mostly wagmi-connector wiring; SODAX EVM slot already takes arbitrary wagmi connectors |
| **Phase 2** | Ledger on Solana, Bitcoin, NEAR, Stellar, Injective, ICON | **M–L** | One custom `XConnector` + `WalletProvider` per chain |
| **Phase 3** | Keystone (QR / air-gapped) on EVM + Solana + Bitcoin | **L** | Needs shipped React UI components — breaks the silent-connector model |
| **Out of scope / blocked** | Sui, Stacks; non-EVM message-signing flows | — | See §6 |

> **Effort scale (indicative — one engineer, to be confirmed with the SDK stream):** **S** ≈ 1–2 weeks · **M** ≈ 3–6 weeks · **L** ≈ 6–12 weeks. Ranges cover build + tests + a device-compatibility pass; they exclude the cross-team review and any partner-driven UI work.

EVM-only support (Phase 1) is low-risk and high-value — it covers 12 of 20 SODAX chains with one device app each — and is the recommended first milestone.

---

## 2. Integration surface in SODAX today

Two packages matter. Neither needs to change for an add-on to plug in.

### `@sodax/wallet-sdk-react` — connection layer
- **`XConnector`** (abstract, `src/core/XConnector.ts`): `connect(): Promise<XAccount>`, `disconnect()`, plus `id` / `name` / `icon` / `isInstalled` / `installUrl` / `xChainType`.
- **`XService`** (abstract, `src/core/XService.ts`): per-chain singleton, `getBalance` / `getBalances`.
- **Per-chain `connectors` config field**: `SodaxWalletConfig` exposes `{ connectors? }` on every chain slot. A partner passes extra connectors here — `chainRegistry` merges them with the defaults. **This is the public, supported extension point.**
- EVM is special: it is wagmi-backed. `EvmXConnector` wraps a wagmi `Connector`, so EVM hardware support means *registering wagmi connectors*, not writing `XConnector` subclasses.

### `@sodax/wallet-sdk-core` — signing layer
- One `WalletProvider` interface per chain family (`IEvmWalletProvider`, `ISolanaWalletProvider`, `IBitcoinWalletProvider`, …), each a discriminated `PrivateKey* | BrowserExtension*` config union.
- A hardware wallet is conceptually **a third config variant** ("hardware"): same interface, signing delegated to the device transport instead of an extension or a raw key.

**Key finding:** the cleanest design implements the *existing* `WalletProvider` interfaces with a hardware-backed signer, and ships matching `XConnector`s. SODAX hooks (`useWalletProvider`, `useXConnect`, the modal primitives) then work unchanged — they only ever see the abstract types.

---

## 3. Per-device survey — transports, SDKs, licensing

Package names verified against npm / vendor docs as of 2026-05.

### 3.1 Ledger

**Transports**

| Transport | Browser support | SODAX fit | Legacy package | DMK package |
|-----------|-----------------|-----------|----------------|-------------|
| **WebHID** | Chromium only (Chrome/Edge/Brave/Opera); no Firefox/Safari | ✅ **Primary** | `@ledgerhq/hw-transport-webhid` | `@ledgerhq/device-transport-kit-web-hid` |
| **WebUSB** | Chromium only | ⚠️ Fallback (flakier — OS USB-claim conflicts with Ledger Live) | `@ledgerhq/hw-transport-webusb` | — *(no DMK WebUSB kit; WebHID is the DMK USB path)* |
| **Web Bluetooth** | Chromium desktop + Android Chrome | ⚠️ Opt-in; enables mobile | `@ledgerhq/hw-transport-web-ble` | `@ledgerhq/device-transport-kit-web-ble` |
| **Node HID** | N/A (Node) | For `apps/node` E2E harness | `@ledgerhq/hw-transport-node-hid` | (DMK Node transport) |
| Raw USB / U2F | — | ❌ Deprecated | — | — |

> **DMK transport note (verified May 2026):** the modern Device Management Kit ships its **own** transport packages — `@ledgerhq/device-transport-kit-web-hid` and `@ledgerhq/device-transport-kit-web-ble`, injected into a `DeviceManagementKitBuilder`. The DMK **web** stack exposes **WebHID and Web Bluetooth only** — there is no dedicated DMK WebUSB transport; **WebHID is the USB path** on DMK. WebUSB remains only on the legacy `hw-transport-*` stack. DMK also has Android and iOS implementations (out of scope for a web add-on).

Stack restriction (Nano S has no BLE) and Bluetooth applying to **Nano X / Stax / Flex** still hold for DMK.

Stance: WebHID default, WebUSB legacy-only fallback, WebBLE opt-in for mobile. All desktop paths are **Chromium-only** — there is no Ledger-in-Safari/Firefox story.

**SDKs — two generations co-exist**

1. **Legacy stack** (still supported, widest chain coverage): `@ledgerhq/hw-transport-*` + per-chain apps — [`hw-app-eth`](https://www.npmjs.com/package/@ledgerhq/hw-app-eth) (one app signs all 12 EVM chains by chainId), [`hw-app-solana`](https://www.npmjs.com/package/@ledgerhq/hw-app-solana), [`hw-app-btc`](https://www.npmjs.com/package/@ledgerhq/hw-app-btc), [`hw-app-near`](https://www.npmjs.com/package/@ledgerhq/hw-app-near), [`hw-app-str`](https://www.npmjs.com/package/@ledgerhq/hw-app-str) (Stellar), [`hw-app-cosmos`](https://www.npmjs.com/package/@ledgerhq/hw-app-cosmos) (Injective), community `hw-app-icx` (ICON), [`@mysten/ledgerjs-hw-app-sui`](https://www.npmjs.com/package/@mysten/ledgerjs-hw-app-sui) (Sui). Transport packages and full link list in §9.
2. **Device Management Kit (DMK)** — modern, recommended: core [`@ledgerhq/device-management-kit`](https://www.npmjs.com/package/@ledgerhq/device-management-kit) + transport kits ([`device-transport-kit-web-hid`](https://www.npmjs.com/package/@ledgerhq/device-transport-kit-web-hid), [`device-transport-kit-web-ble`](https://www.npmjs.com/package/@ledgerhq/device-transport-kit-web-ble)) + one signer kit per chain ([`device-signer-kit-ethereum`](https://www.npmjs.com/package/@ledgerhq/device-signer-kit-ethereum) v1.15.x, [`device-signer-kit-solana`](https://www.npmjs.com/package/@ledgerhq/device-signer-kit-solana) v1.5.x, `device-signer-kit-bitcoin`). **Caveat:** signer kits exist only for major chains today — NEAR, Stellar, Injective/Cosmos, ICON, Sui still require legacy `hw-app-*`. A full-coverage add-on therefore runs **both stacks**: DMK (core + transport kits + signer kit) where a signer kit exists, legacy `hw-transport-* + hw-app-*` elsewhere.

**Licensing:** all `@ledgerhq/*` transports, apps, DMK, and signer kits are **Apache-2.0 / MIT** — free, no key, no commercial agreement. Community apps (`hw-app-icx`, `@zondax/ledger-stacks`) are permissive but **not Ledger-maintained** — supply-chain/maintenance risk.

**UX model:** silent-ish — connect = device unlock + open the chain app; each signature confirmed on-device. Fits `XConnector.connect()` with an "open the X app on your Ledger" prompt.

**Message signing:** EVM `personal_sign` ✅, EIP-712 ✅ (complex structs may fall back to blind-signing). Non-EVM off-chain message signing is **inconsistent** — see §6.1.

**Verdict:** broadest chain coverage of the three; best fit for SODAX's chain set. Primary target.

### 3.2 Trezor

**Transports** — the integrator does **not** pick a transport; Trezor Connect abstracts it.

| Layer | What it is | SODAX fit |
|-------|-----------|-----------|
| **Hosted popup** | Secure window served from `connect.trezor.io/9/popup.html`; the popup brokers the device connection. Host app talks to it via `postMessage`. | ✅ Default for web apps |
| **WebUSB** (under the popup) | Default device path in Chromium. Chrome now prefers WebUSB and bypasses any local daemon. | ✅ Implicit (Chromium) |
| **trezord-go daemon** (ex–"Trezor Bridge") | **Standalone Trezor Bridge was deprecated in 2025.** A `trezord-go` daemon is still needed where WebUSB is unavailable — notably **Firefox** (no WebUSB support) and some OS/older-device cases. | ⚠️ Required for Firefox / fallback |
| **Direct WebUSB API** | Not exposed to integrators — the popup owns the connection. | ❌ Not an integration path |

No QR, no Bluetooth — all Trezor models are USB-only.

> **Transport note (verified May 2026):** standalone Trezor Bridge is **deprecated**; in current Chromium browsers Trezor Connect connects over **WebUSB** with no daemon install. **Firefox still requires a local daemon** because it does not support WebUSB — so "works in any browser" is not literally true: Firefox users need `trezord-go`. This is a real partner-onboarding caveat.

**SDKs — Trezor Connect v9** (v8 in maintenance mode; new integrations use v9):
- [`@trezor/connect-web`](https://www.npmjs.com/package/@trezor/connect-web) — **the package for a web dApp**; loads the popup from `connect.trezor.io/<version>/`.
- [`@trezor/connect`](https://www.npmjs.com/package/@trezor/connect) — Node / non-browser core.
- [`@trezor/connect-webextension`](https://www.npmjs.com/package/@trezor/connect-webextension) — service-worker-compatible; only if a partner ships a browser extension.

**Architectural consequence:** Trezor Connect is a **runtime dependency on `connect.trezor.io`** — a third-party origin loaded at use time. Affects partner CSP, offline behavior, and privacy review; cannot be fully self-hosted for the standard flow. This is the biggest structural difference vs Ledger (pure local USB).

**Licensing:** Trezor Connect / `trezor-suite` are **open source** but the monorepo mixes GPL-family and permissive licenses — **a license audit is required before bundling.** No API key, but Trezor recommends registering the app domain for trusted-origin handling.

**Chain coverage (verified against `trezor.io/coins`, May 2026):** Bitcoin ✅, Solana ✅ (Safe 3 / Safe 5 / Safe 7 / Model T), Cardano, XRP. EVM — Trezor Suite **natively** lists Ethereum, Polygon PoS, BNB Smart Chain, Arbitrum One, Base, Optimism; **Avalanche is not in the native Suite list.** Trezor Connect's `ethereumSignTransaction` will still sign **any** EVM `chainId` (so all 12 SODAX EVM chains are reachable), but clear-display / token recognition is limited to known networks — see §4.2. **No support:** NEAR, ICON, Injective/Cosmos, Sui, Stacks. Stellar (XLM) signing is available via Trezor Connect.

**UX model:** popup-driven — each call uses the visible, Trezor-hosted popup. Maps onto `XConnector`.

**Message signing:** EVM `personal_sign` / EIP-712 ✅, Bitcoin ✅.

**Verdict:** strong on EVM + BTC; ship alongside Ledger in Phase 1–2. Coverage stops well short of SODAX's long tail.

### 3.3 Keystone

**Transport — QR only** (the defining constraint):

| Transport | Available? | Notes |
|-----------|-----------|-------|
| **Animated QR** | ✅ The only integration transport | Air-gapped. Data chunked across multiple QR frames (UR — Uniform Resources, `@ngraveio/bc-ur` encoding) since one QR holds limited bytes. |
| USB | USB-C is **charge-only** — no data path for signing (verified, Keystone 3 Pro, May 2026). | ❌ |
| Bluetooth / NFC / WiFi | None — fully air-gapped by design. | ❌ |

The signing handshake is inherently **multi-step and interactive**: app displays an animated QR (unsigned tx) → user scans with device + signs on-device → device displays an animated QR (signature) → app scans it back with the webcam.

**SDKs:** [`@keystonehq/keystone-sdk`](https://www.npmjs.com/package/@keystonehq/keystone-sdk) (encodes tx → QR payloads, parses scanned QR → signatures; chain-aware: EVM, BTC, Solana, NEAR, Cosmos, Sui, etc.), [`@keystonehq/animated-qr`](https://www.npmjs.com/package/@keystonehq/animated-qr) (React components to present + scan animated QR), underlying [`@ngraveio/bc-ur`](https://www.npmjs.com/package/@ngraveio/bc-ur). Integration guide: [Keystone developer portal](https://dev.keyst.one/docs/integration-guide-basics/install-the-sdk). Full link list in §9.

**Licensing:** `@keystonehq/*` SDK packages and firmware are **open source, MIT-family** — free, no key, no agreement.

**Why Keystone forces a different add-on shape:** Ledger and Trezor map onto `XConnector.connect()` / `WalletProvider.signTransaction()` — connection and signing complete within a method call (Ledger silently, Trezor via its own popup). **Keystone cannot** — every signature needs camera + QR-display UI and round-trips through user action. The add-on must ship **React UI components** (`@keystonehq/animated-qr` wrapped in SODAX-styled headless hooks) and a **stateful signing flow**, not just a connector. This is the cost driver behind Phase 3.

**Message signing:** per-chain via UR types; supported where the device supports it.

**Verdict:** feasible but the most expensive. Defer to Phase 3.

### 3.4 Cross-device summary

| | Ledger | Trezor | Keystone |
|---|--------|--------|----------|
| **Transports** | WebHID (primary), WebUSB (legacy stack only), Web BLE (Nano X/Stax/Flex) | Popup over WebUSB (Chromium); `trezord-go` daemon for Firefox | Animated QR only (air-gapped — USB-C is charge-only) |
| **Browser reach** | Chromium desktop only; +Android via BLE | Chromium daemon-free; **Firefox needs `trezord-go`**; no Safari | Any browser with a webcam |
| **Web SDK** | DMK (core + transport kits + signer kits) **+** legacy `hw-transport-*`/`hw-app-*` | `@trezor/connect-web` v9 | `@keystonehq/keystone-sdk` + `@keystonehq/animated-qr` |
| **3rd-party runtime dep** | None (local USB) | **Yes** — `connect.trezor.io` popup | None (camera local) |
| **Licensing** | Apache-2.0 / MIT, free | Open source — **GPL audit needed** before bundling | MIT-family, free |
| **Fits `XConnector` model** | ✅ cleanly | ✅ (with visible Trezor popup) | ❌ needs shipped UI + stateful flow |

---

## 4. Capability mapping — devices × SODAX chains & transaction formats

SODAX spans 20 chains: 12 EVM + Solana, Sui, Stellar, ICON, Injective, NEAR, Stacks, Bitcoin. This section maps each device's signing capability onto **both** the chains **and** the transaction/message formats SODAX actually requires (epic requirement 2). Transaction-signing and message-signing are tabulated separately because they diverge sharply per device.

Legend: ✅ supported · ⚠️ partial / conditional / unverified · ❌ no support.

### 4.1 What SODAX asks a signer to do

Per chain family, the `WalletProvider` interfaces in `@sodax/wallet-sdk-core` and the spoke services require:

| Chain family | Transaction format | Message / typed-data signing SODAX uses |
|---|---|---|
| EVM (×12) | Legacy + EIP-1559 txs (viem) | EIP-712 typed data (intents), `personal_sign` |
| Solana | Legacy + versioned (v0) txs (`buildV0Txn`) | off-chain message signing |
| Sui | Programmable transaction blocks (BCS) | personal-message / intent signing |
| Stellar | XDR transaction envelopes; Soroban auth entries | — |
| ICON | ICON JSON-RPC tx | — |
| Injective | Cosmos `SIGN_MODE_DIRECT` (protobuf) + Amino | Amino / ADR-036 arbitrary signing |
| NEAR | NEAR tx (Borsh) | — |
| Stacks | Stacks tx (Clarity) | structured / message signing |
| Bitcoin | PSBT (`signTransaction`) | BIP-322 + ECDSA (`signBip322Message` / `signEcdsaMessage`) |

Exact per-flow needs (which SODAX operations sign a *message* vs a *transaction*) are confirmed in the §8 step-1 signing audit.

### 4.2 Transaction-signing coverage

EVM is split into two tiers — device **clear-signing** (human-readable on-device display) depends on whether the chain is in the device's known-network registry; chains outside it still sign but fall back to **blind-signing**. **The known-network set is device-specific** — the tiers below are Ledger-shaped; Trezor's clear-display set is narrower (see note under the table).

| SODAX chain | Ledger | Trezor | Keystone |
|---|---|---|---|
| **EVM — major** (Ethereum, Arbitrum, Base, BSC, Optimism, Polygon, Avalanche) | ✅ ETH app / `device-signer-kit-ethereum` — clear-signing | ✅ Connect signs all · ⚠️ Avalanche not in Suite's native list | ✅ |
| **EVM — long tail** (Sonic hub, HyperEVM, Lightlink, Redbelly, Kaia) | ✅ signs by chainId · ⚠️ **blind-signing** if not in clear-signing registry | ✅ signs (pass chain params) · ⚠️ generic display | ✅ · ⚠️ display varies |
| Bitcoin | ✅ `hw-app-btc` / Bitcoin signer kit (PSBT) | ✅ Connect (PSBT) | ✅ |
| Solana | ✅ `hw-app-solana` / Solana signer kit (v0 txs) | ✅ Connect — Safe 3/5/7 + Model T | ✅ |
| Sui | ⚠️ `hw-app-sui` / `app-sui` — available; Clear Signing emerging, Ledger Live rollout in progress | ❌ | ✅ |
| Stellar | ✅ `hw-app-str` — tx + Soroban auth + hash-sign | ✅ Connect | ⚠️ unverified |
| Injective | ✅ `hw-app-cosmos` (DIRECT / Amino) | ❌ | ✅ (Cosmos integration) |
| NEAR | ✅ `hw-app-near` | ❌ | ⚠️ unverified |
| ICON | ⚠️ community `hw-app-icx` — not Ledger-maintained | ❌ | ❌ |
| Stacks | ⚠️ community `@zondax/ledger-stacks` — exotic, low-maintenance | ❌ | ❌ |

> **Trezor clear-display caveat (verified `trezor.io/coins`, May 2026):** Trezor Connect's `ethereumSignTransaction` signs **any** EVM `chainId`, so all 12 SODAX EVM chains are reachable. But Trezor Suite's *natively recognised* EVM set is Ethereum, Polygon PoS, BNB Smart Chain, Arbitrum One, Base, Optimism — **Avalanche and all 5 long-tail chains fall outside it**, so on-device display is generic. For SODAX, treat Trezor's clear-signing tier as the 6 networks above; everything else signs blind.

### 4.3 Message / typed-data-signing coverage (the §6.1 risk surface)

| SODAX chain | What SODAX signs | Ledger | Trezor | Keystone |
|---|---|---|---|---|
| EVM | EIP-712 typed data, `personal_sign` | ✅ — complex structs → blind-sign | ✅ | ✅ |
| Bitcoin | BIP-322 **and** ECDSA | ⚠️ ECDSA only — **BIP-322 not supported** | ⚠️ ECDSA only | ⚠️ varies |
| Solana | off-chain message | ⚠️ limited / app-version dependent | ❌ | ⚠️ |
| Sui | personal message | ⚠️ unverified | ❌ | ⚠️ |
| Injective | ADR-036 arbitrary | ⚠️ Amino-mode only | ❌ | ⚠️ |
| Stellar | (per audit) | ⚠️ hash-sign only — must be enabled on-device | ✅ Connect | ⚠️ |
| ICON / NEAR / Stacks | (per audit) | ⚠️ tx-sign only, no arbitrary message | ❌ | ⚠️ |

**Bitcoin BIP-322 is a hard blocker if a SODAX flow requires it.** Neither Ledger nor Trezor signs BIP-322 messages — their Bitcoin apps do ECDSA message signing only. SODAX's `BitcoinSpokeService` / `RadfiProvider.authenticateWithWallet` auto-selects **BIP-322 for P2WPKH/P2TR (SegWit/Taproot) addresses**. A hardware-wallet Bitcoin user on a Taproot or native-SegWit address would fail message-based authentication. Mitigations: (a) restrict HW Bitcoin connect to P2SH/P2PKH (legacy) addresses, or (b) confirm the flow can fall back to a transaction-based proof. **Resolve in the §8 audit before promising Bitcoin HW support.**

### 4.4 Coverage tiers (planning view)

- **Tier 1 — production-ready:** all 12 EVM chains, all three devices. Covers SODAX's hub (Sonic) + every EVM spoke. Caveat: 5 long-tail EVM chains may blind-sign rather than clear-sign.
- **Tier 2 — solid, Ledger-led:** Bitcoin, Solana, Stellar, Injective, NEAR. Trezor adds Bitcoin / Solana / Stellar; Keystone adds Bitcoin / Solana / Sui / Injective.
- **Tier 3 — best-effort, community apps:** Sui (Ledger — emerging), ICON, Stacks. Gate behind runtime capability detection; do **not** promise 20/20.
- **No coverage:** Trezor on NEAR, ICON, Injective, Sui, Stacks.

**Reading the matrix:** EVM transaction signing is universally covered — the strong, low-risk core. The real exposure is two-fold: (1) the non-EVM long tail (ICON, Sui, Stacks) where SODAX is most differentiated has the weakest device support, and (2) **message signing is far thinner than transaction signing on every device** — the §6.1 gap. Plan for graceful per-chain, per-capability feature detection rather than a flat "hardware wallets supported" claim.

---

## 5. Proposed standalone add-on SDK

### 5.1 Shape and constraints
- **Package:** `@sodax/wallet-hw` (new package in this monorepo, or a sibling repo). **Not** a dependency of `@sodax/sdk` or `@sodax/wallet-sdk-core`.
- **Peer deps:** `@sodax/wallet-sdk-react`, `@sodax/wallet-sdk-core`, `@sodax/types` (peer, not direct — partner already has them).
- **Device deps:** Ledger / Trezor / Keystone packages are **optional, lazily imported** (`await import(...)` inside `connect()`, mirroring how `XverseXConnector` lazy-loads `sats-connect`). A partner who only wants Ledger never bundles Trezor.
- **Framework support:** core connectors are framework-agnostic; React is the supported binding (matches `wallet-sdk-react`). Keystone's QR components are React-only in Phase 3.

**Install & distribution model**
- Published to npm as a normal versioned package — partners add it with one command:

  ```bash
  pnpm add @sodax/wallet-hw     # or npm install / yarn add
  ```
- **Semver, released independently** of `@sodax/sdk` — because it is not a core dependency, a hardware-wallet release never forces a core-SDK version bump, and vice versa.
- Ships **dual ESM + CJS** with type declarations, matching the other `@sodax/*` packages (tsup build).
- Optional sub-path exports for tree-shaking — e.g. `@sodax/wallet-hw/keystone` pulls in QR/React code only when imported, so Ledger-only or Trezor-only partners keep a minimal bundle.
- A partner who never installs `@sodax/wallet-hw` sees zero change in their core-SDK footprint — the add-on is purely opt-in.

### 5.2 API surface (draft)

Connectors — drop-in `XConnector` / wagmi connectors, consumed via the existing `connectors` config field:

```ts
import { Sodax } from '@sodax/sdk';
import { SodaxWalletProvider } from '@sodax/wallet-sdk-react';
import {
  ledgerEvmConnectors,      // wagmi Connector[] — EVM
  trezorEvmConnectors,      // wagmi Connector[] — EVM
  LedgerSolanaXConnector,   // XConnector subclass
  LedgerBitcoinXConnector,
  KeystoneEvmXConnector,
} from '@sodax/wallet-hw';

const walletConfig = {
  EVM: {
    connectors: [...ledgerEvmConnectors(), ...trezorEvmConnectors()],
  },
  SOLANA: {
    connectors: [new LedgerSolanaXConnector({ transport: 'webhid' })],
  },
  BITCOIN: {
    connectors: [new LedgerBitcoinXConnector()],
  },
};

<SodaxWalletProvider config={walletConfig}> … </SodaxWalletProvider>;
```

Keystone (Phase 3) additionally exports headless React pieces, because QR signing is interactive:

```tsx
import { KeystoneQRProvider, useKeystoneScanner, KeystoneSignModal } from '@sodax/wallet-hw/keystone';
// app wraps tree in <KeystoneQRProvider/>; the add-on drives the
// display-QR → scan-device → scan-back handshake.
```

Internally each connector builds a hardware-backed `WalletProvider` implementing the **existing** core interface, so `useWalletProvider(spokeChainId)` returns it transparently:

```ts
class LedgerEvmWalletProvider implements IEvmWalletProvider {
  // signs via @ledgerhq/hw-app-eth over a WebHID transport
  async sendTransaction(tx) { … }
  async waitForTransactionReceipt(hash) { … }
  getWalletAddress() { … }
}
```

### 5.3 Why this fits SODAX cleanly
- `XConnector` and the `WalletProvider` interfaces are already abstract — subclassing is the intended extension path (see "Adding a New Chain" in both package guides).
- The `connectors` config field is already public API; no `chainRegistry` change.
- SODAX hooks and the wallet-modal primitives (`useWalletModal`, `useBatchConnect`, `sortConnectors`) operate purely on the abstract types — hardware connectors appear in the modal automatically, with their own `icon` / `isInstalled` / `installUrl`.

### 5.4 Partner integration story

This section is the partner's-eye view — how a wallet, DEX, or aggregator already building on SODAX adopts hardware-wallet sign-in.

**Starting point.** The partner already ships `@sodax/sdk` and wraps their app in `<SodaxWalletProvider>` from `@sodax/wallet-sdk-react`. Their users today connect via browser-extension and WalletConnect wallets.

**What adoption looks like:**

1. **Install** — `pnpm add @sodax/wallet-hw`. No change to `@sodax/sdk`; no core-SDK version bump.
2. **Wire connectors** — import the hardware connectors and add them to the `connectors` array of the relevant chain slot in the existing `SodaxWalletConfig` (see §5.2). For EVM that is one line; nothing else in their setup changes.
3. **Ship** — the partner's existing wallet UI (whether they use SODAX's modal primitives or their own) now lists Ledger and Trezor automatically, because connectors carry their own `name` / `icon` / `isInstalled`. No UI rewrite for Phase 1–2.
4. **Keystone (Phase 3)** — partners who want air-gapped support additionally mount the QR components from `@sodax/wallet-hw/keystone`; this is the only case that touches their UI tree.

**What does *not* change for the partner:** their SODAX SDK calls (swaps, lending, migration), their `useWalletProvider` usage, their transaction flows. A hardware wallet surfaces as the same typed `WalletProvider` the SDK already consumes — the partner's business logic is signer-agnostic.

**Adoption by partner type:**

| Partner type | Primary motivation | Typical scope |
|---|---|---|
| **Wallet** | Offer hardware sign-in as a first-class connect option | EVM + the non-EVM chains they support |
| **DEX** | Let high-value traders sign swaps from cold storage | EVM-first (Phase 1) covers most volume |
| **Aggregator** | Match the wallet coverage users already expect | EVM-first; add chains as demand appears |

**Effort on the partner side:** Phase 1 (EVM) is an afternoon — install + a few lines of config. The cost is borne by the add-on, not the integrator: SODAX maintains the connectors, the device-compatibility matrix, and the firmware-drift handling (§6.7). This division of labour is the core value proposition — partners get hardware-wallet support without owning any device-integration code.

---

## 6. Risks, blockers, and open questions

1. **Message-signing gap (highest risk).** SODAX flows authenticate / authorize with signed messages (e.g. Bitcoin BIP-322 / ECDSA in `RadfiProvider`, EIP-712 intents). Hardware wallets reliably sign **transactions**; **arbitrary off-chain message signing is inconsistent** outside EVM (Solana off-chain messages limited; Stellar / ICON / NEAR vary by app/firmware). **Action:** audit every SODAX flow for where it signs a *message* vs a *transaction*, per chain, before promising non-EVM support.
2. **Keystone breaks the silent-connector model.** `connect()` / `sign*()` cannot complete synchronously — they need a camera + animated-QR handshake. The add-on must ship UI and a stateful flow; partners with custom UI need headless hooks. Drives Phase 3 cost.
3. **Trezor hosted popup + Firefox daemon.** `connect.trezor.io` is a third-party runtime dependency — availability, CSP, and privacy implications for partners. `@trezor/connect-webextension` mitigates only in extension contexts. Additionally, standalone Trezor Bridge is **deprecated** (2025): Chromium connects daemon-free over WebUSB, but **Firefox still needs a local `trezord-go` daemon** because it has no WebUSB — a partner-onboarding caveat for Firefox users.
4. **Browser transport constraints.** WebHID / WebUSB / WebBluetooth require HTTPS and a user gesture; **Ledger desktop is Chromium-only** (no Safari/Firefox), Ledger DMK web exposes WebHID + WebBLE only (no WebUSB kit). Mobile browsers largely unsupported (Ledger Android-via-BLE aside) — hardware sign-in is effectively desktop-only. Must be stated in partner docs.
5. **Long-tail chains.** Sui Ledger support is **emerging** (`app-sui` exists, Clear Signing + Ledger Live rollout in progress) but tooling is young; ICON and Stacks rely on unmaintained community apps. Treat as best-effort with runtime feature detection, not guaranteed coverage.
6. **EIP-712 blind-signing.** Complex SODAX intent structs may exceed Ledger clear-signing support, forcing blind-signing — a UX/security wrinkle to validate against real intent payloads.
7. **Firmware / app-version drift.** Device behavior changes across firmware. The add-on needs a version-detection + capability-probe layer and a tested-matrix doc.
8. **Open questions for SDK-stream owners:** (a) new in-repo package vs separate repo? (b) is Phase-1 EVM-only an acceptable first GA? (c) which partners have committed demand, and for which chains — to prioritise Phase 2 ordering? (d) who owns the firmware-compatibility test matrix long-term?

---

## 7. Recommendation & go / no-go criteria

**Build — phased, starting EVM-only.**

- **Go for Phase 1** (Ledger + Trezor, 12 EVM chains): low risk, no core changes, ~12/20 chains covered. **Effort: S–M** (wagmi connector wiring + a `LedgerEvmWalletProvider` over WebHID; Trezor via `@trezor/connect-web`).
- **Go for Phase 2** (Ledger non-EVM) **conditional on** the §6.1 message-signing audit passing per chain. **Effort: M–L** — one `XConnector` + `WalletProvider` pair per chain.
- **Conditional Phase 3** (Keystone): proceed only with confirmed partner demand, given the UI cost. **Effort: L.**
- **No-go (for now):** Sui, Stacks, and any chain whose SODAX flow needs arbitrary message signing the device cannot provide. Revisit when device tooling matures.

**Explicit go/no-go gates for the follow-up implementation epic**
- GO if: a partner commits to consuming it; the message-signing audit clears EVM + at least Bitcoin/Solana; SDK owners approve the new package.
- NO-GO / hold if: no partner demand; the audit shows core SODAX intent flows can't be signed on-device for the target chains.

**Suggested follow-up epic:** "Implement `@sodax/wallet-hw` — Phase 1 (Ledger + Trezor, EVM)", estimated **S–M**, with Phase 2/3 as separate scoped epics.

---

## 8. Next steps before closing this research epic
1. Run the per-chain message-signing audit (§6.1) — the single biggest unknown.
2. Confirm package placement (in-repo vs sibling repo) with SDK-stream owners.
3. Review this doc with SDK-stream owners; link it on the epic; record the verdict.
4. File the Phase-1 implementation epic.

---

## 9. References

All links verified May 2026. Package versions move — treat npm pages as the source of truth.

### Ledger

| Resource | Link |
|---|---|
| Developer portal | https://developers.ledger.com/ |
| Device Management Kit — getting started | https://developers.ledger.com/docs/device-interaction/getting-started |
| DMK — transports guide | https://developers.ledger.com/docs/device-interaction/integration/how_to/transports |
| `device-sdk-ts` monorepo (DMK source) | https://github.com/LedgerHQ/device-sdk-ts |
| `ledger-live` monorepo (legacy `ledgerjs` packages) | https://github.com/LedgerHQ/ledger-live |
| npm — `@ledgerhq/device-management-kit` | https://www.npmjs.com/package/@ledgerhq/device-management-kit |
| npm — `@ledgerhq/device-transport-kit-web-hid` | https://www.npmjs.com/package/@ledgerhq/device-transport-kit-web-hid |
| npm — `@ledgerhq/device-transport-kit-web-ble` | https://www.npmjs.com/package/@ledgerhq/device-transport-kit-web-ble |
| npm — `@ledgerhq/device-signer-kit-ethereum` | https://www.npmjs.com/package/@ledgerhq/device-signer-kit-ethereum |
| npm — `@ledgerhq/device-signer-kit-solana` | https://www.npmjs.com/package/@ledgerhq/device-signer-kit-solana |
| npm — `@ledgerhq/device-signer-kit-bitcoin` | https://www.npmjs.com/package/@ledgerhq/device-signer-kit-bitcoin |
| npm — `@ledgerhq/hw-transport-webhid` (legacy) | https://www.npmjs.com/package/@ledgerhq/hw-transport-webhid |
| npm — `@ledgerhq/hw-transport-webusb` (legacy) | https://www.npmjs.com/package/@ledgerhq/hw-transport-webusb |
| npm — `@ledgerhq/hw-transport-web-ble` (legacy) | https://www.npmjs.com/package/@ledgerhq/hw-transport-web-ble |
| npm — `@ledgerhq/hw-app-eth` | https://www.npmjs.com/package/@ledgerhq/hw-app-eth |
| npm — `@ledgerhq/hw-app-solana` | https://www.npmjs.com/package/@ledgerhq/hw-app-solana |
| npm — `@ledgerhq/hw-app-btc` | https://www.npmjs.com/package/@ledgerhq/hw-app-btc |
| npm — `@ledgerhq/hw-app-near` | https://www.npmjs.com/package/@ledgerhq/hw-app-near |
| npm — `@ledgerhq/hw-app-str` (Stellar) | https://www.npmjs.com/package/@ledgerhq/hw-app-str |
| npm — `@ledgerhq/hw-app-cosmos` (Injective) | https://www.npmjs.com/package/@ledgerhq/hw-app-cosmos |
| npm — `@mysten/ledgerjs-hw-app-sui` | https://www.npmjs.com/package/@mysten/ledgerjs-hw-app-sui |
| GitHub — `LedgerHQ/app-sui` (Sui device app) | https://github.com/LedgerHQ/app-sui |
| Ledger Sui support article | https://support.ledger.com/article/10136570195101-zd |

### Trezor

| Resource | Link |
|---|---|
| Trezor Connect explorer / docs (v9) | https://connect.trezor.io/9/ |
| `trezor-suite` monorepo | https://github.com/trezor/trezor-suite |
| Connect package source + docs | https://github.com/trezor/trezor-suite/tree/develop/packages/connect |
| npm — `@trezor/connect-web` | https://www.npmjs.com/package/@trezor/connect-web |
| npm — `@trezor/connect` | https://www.npmjs.com/package/@trezor/connect |
| npm — `@trezor/connect-webextension` | https://www.npmjs.com/package/@trezor/connect-webextension |
| Supported coins & assets | https://trezor.io/coins |
| Standalone Trezor Bridge deprecation (forum) | https://forum.trezor.io/t/deprecation-and-removal-of-standalone-trezor-bridge/25288 |

### Keystone

| Resource | Link |
|---|---|
| Keystone developer portal | https://dev.keyst.one/ |
| SDK install guide | https://dev.keyst.one/docs/integration-guide-basics/install-the-sdk |
| Keystone developer hub (GitHub) | https://github.com/KeystoneHQ/Keystone-developer-hub |
| npm — `@keystonehq/keystone-sdk` | https://www.npmjs.com/package/@keystonehq/keystone-sdk |
| npm — `@keystonehq/animated-qr` | https://www.npmjs.com/package/@keystonehq/animated-qr |
| npm — `@ngraveio/bc-ur` (UR encoding) | https://www.npmjs.com/package/@ngraveio/bc-ur |
| Keystone 3 Pro (product / air-gapped spec) | https://keyst.one/shop/products/keystone-3-pro |

### Standards & web platform APIs

| Resource | Link |
|---|---|
| EIP-712 — typed structured data signing | https://eips.ethereum.org/EIPS/eip-712 |
| EIP-1559 — fee market / transaction type | https://eips.ethereum.org/EIPS/eip-1559 |
| BIP-174 — PSBT (Partially Signed Bitcoin Tx) | https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki |
| BIP-322 — generic signed message format | https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki |
| Cosmos ADR-036 — arbitrary message signing | https://docs.cosmos.network/main/build/architecture/adr-036-arbitrary-signature |
| WebHID API (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API |
| WebUSB API (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API |
| Web Bluetooth API (MDN) | https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API |

### SODAX & ecosystem

| Resource | Link |
|---|---|
| This epic — `icon-project/sodax-frontend#1348` | https://github.com/icon-project/sodax-frontend/issues/1348 |
| wagmi — connectors documentation | https://wagmi.sh/react/api/connectors |
| `@sodax/wallet-sdk-react` — package guide | ../../packages/wallet-sdk-react/CLAUDE.md |
| `@sodax/wallet-sdk-core` — package guide | ../../packages/wallet-sdk-core/CLAUDE.md |
