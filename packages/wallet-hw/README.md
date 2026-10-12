# @sodax/wallet-hw

Optional **hardware-wallet add-on** for the Sodax wallet SDK. It is fully opt-in — **not** a
dependency of `@sodax/sdk` or `@sodax/wallet-sdk-core`. A partner who never installs it sees no change
in their core-SDK footprint.

> **Status:** Phase 1 — **Ledger and Trezor on EVM** (all 12 SODAX EVM chains). Ledger over
> WebHID/WebUSB; Trezor over the Trezor Connect popup. Keystone and non-EVM chains are planned follow-ups.

## Install

```bash
pnpm add @sodax/wallet-hw
```

`viem` and `wagmi` are peer dependencies (you already have them via `@sodax/wallet-sdk-react`). The
Ledger device SDKs (`@ledgerhq/*`) are direct deps, kept **external** from this package's bundle — they
enter your app's graph only when you import the Ledger entry.

## Usage

Add the hardware connector(s) to the EVM slot of your existing `SodaxWalletProvider` config via the
`wagmiConnectors` field. Nothing else in your setup changes — the connectors appear in the wallet
modal automatically, and `useWalletProvider(spokeChainId)` returns the same typed `EvmWalletProvider`
the SDK already consumes.

```tsx
import { SodaxWalletProvider, type SodaxWalletConfig } from '@sodax/wallet-sdk-react';
import { ledgerEvmConnectors, trezorEvmConnectors } from '@sodax/wallet-hw';

const walletConfig: SodaxWalletConfig = {
  EVM: {
    wagmiConnectors: [...ledgerEvmConnectors(), ...trezorEvmConnectors()],
    // ...your existing EVM config (walletConnect, chains, etc.)
  },
};

<SodaxWalletProvider config={walletConfig}>{children}</SodaxWalletProvider>;
```

Import only the device you need (`@sodax/wallet-hw/ledger` or `@sodax/wallet-hw/trezor`) to keep the
other vendor SDK out of your bundle.

### Options

```ts
import { ledgerConnector } from '@sodax/wallet-hw';

ledgerConnector({
  transport: 'webhid',              // 'webhid' (default) | 'webusb'
  derivationPath: "44'/60'/0'/0/0", // default Ledger Live EVM path, account 0
  id: 'sodaxLedger',
  name: 'Ledger',
});
```

```ts
import { trezorConnector } from '@sodax/wallet-hw';

trezorConnector({
  // Set a real manifest in production so Trezor can attribute traffic to your app.
  manifest: { email: 'you@example.com', appUrl: 'https://your.app', appName: 'Your App' },
  derivationPath: "m/44'/60'/0'/0/0", // Trezor expects the `m/` prefix
  id: 'sodaxTrezor',
  name: 'Trezor',
});
```

`ledgerEvmConnectors(params?)` / `trezorEvmConnectors(params?)` are the array convenience wrappers.

## What it signs

- **Transactions** — EIP-1559 (default) and legacy, across all 12 EVM chains, signed on-device and
  broadcast over the chain's configured RPC.
- **Messages** — `personal_sign` and `eth_signTypedData_v4` (EIP-712 intents).

## Constraints

- **Desktop only.** Ledger uses WebHID/WebUSB — **Chromium only** (Chrome / Edge / Brave / Opera), no
  Safari/Firefox, no mobile. Trezor uses the hosted popup at `connect.trezor.io` (a third-party origin
  loaded at use time; Firefox additionally needs the `trezord-go` daemon). `connect()` must run inside a
  user gesture (a click) over HTTPS.
- **Blind-signing** by default — chains/contracts outside the device's clear-signing registry display
  generic data on-device. Clear-signing resolution is a planned enhancement.
- **No auto-reconnect** — hardware connectors do not silently reconnect on page load (the device would
  otherwise be woken / the popup spawned on every mount). Users reconnect explicitly.

## License

MIT
