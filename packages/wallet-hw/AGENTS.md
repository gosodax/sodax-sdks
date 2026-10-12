# packages/wallet-hw

Optional, opt-in **hardware-wallet add-on** for the Sodax wallet SDK. **Not** a dependency of
`@sodax/sdk` or `@sodax/wallet-sdk-core` — a partner installs it separately and wires connectors into
the existing wallet layer. Derived from `docs/research/hardware-wallet-sdk-feasibility.md` (Phase 1).

## Scope (current)

- **Ledger on EVM** — wagmi connector over WebHID (primary) / WebUSB (fallback).
- **Trezor on EVM** — wagmi connector over `@trezor/connect-web` (the Trezor-hosted popup).
- Both cover all 12 SODAX EVM chains.
- **Planned (not yet here):** Keystone QR (`src/keystone/` + React UI), non-EVM chains, Ledger
  clear-signing resolution, dual-CJS output.

## How it plugs in (no core change beyond one field)

EVM connectors come from the **wagmi config**, not the per-chain `connectors` override (that field is
read only for non-provider chains in `chainRegistry`). The single enabler in `@sodax/wallet-sdk-react`
is the `EVM.wagmiConnectors?: CreateConnectorFn[]` field (`src/types/config.ts`), which `EvmProvider`
appends to the wagmi config. Once a connector with a stable `id` is in that config:

- `EvmActions.connect(id)` finds it and calls wagmi `connectAsync`,
- `EvmHydrator` turns its wallet client into the SODAX `EvmWalletProvider`,
- it appears in the wallet modal via `EvmXConnector` (using the connector's `name`/`icon`).

So **no custom `IEvmWalletProvider` is needed** for EVM — wagmi's wallet client flows through unchanged.

## Architecture

A device-agnostic base provider holds everything that is not device-specific; each device is a thin
subclass plus a wagmi connector.

| File | Role |
|------|------|
| `shared/BaseEvmHwProvider.ts` | Abstract EIP-1193 provider. Owns the JSON-RPC **request router**, read-forwarding, transaction **field-filling**, `yParity`-by-recovery, and viem serialization. Three `abstract` signing primitives are implemented per device. |
| `ledger/LedgerEvmProvider.ts` | Subclass over `@ledgerhq/hw-app-eth` (blind-sign, `resolution: null`). |
| `ledger/transport.ts` | Opens `@ledgerhq/hw-transport-webhid` / `-webusb` and builds the `hw-app-eth` client. |
| `ledger/ledgerConnector.ts` | `ledgerConnector()` / `ledgerEvmConnectors()` — wagmi `createConnector` factory. |
| `trezor/TrezorEvmProvider.ts` | Subclass over `@trezor/connect-web` (`ethereumSign*`). Trezor returns a ready serialized tx, so it bypasses the base's recovery+serialize and broadcasts that directly. |
| `trezor/trezorConnector.ts` | `trezorConnector()` / `trezorEvmConnectors()`. Guards the global `TrezorConnect.init()` with a shared promise; accepts a `manifest`. |

### Key design points

- **The connector factory receives `{ chains, emitter, transports }`, not the full wagmi `Config`.** RPC
  reads are forwarded by building a viem `Client` from `chains` + `transports[chainId]` (cached per chain).
- **`yParity` is derived by recovery** (`BaseEvmHwProvider.recoverAndSerialize`), not by interpreting the
  device's returned `v` — uniform across legacy and EIP-1559, and it sidesteps the EIP-155 large-chain-id
  `v` reconstruction pitfalls. (Trezor returns its own serialized tx, so it skips this.)
- **Transactions default to EIP-1559**; legacy is used only when the caller supplies `gasPrice`. Missing
  fields (nonce/gas/fees) are filled from the RPC before device signing.
- **Message signatures**: Ledger assembles `0x{r}{s}{v}` with `v` normalised to 27/28; Trezor returns the
  full signature, which is just 0x-prefixed.
- **EIP-712** uses viem `hashDomain` + `hashStruct` (Ledger → `signEIP712HashedMessage`; Trezor passes both
  the typed data and the hashes for firmware compatibility).
- **`isAuthorized()` returns `false`** for both connectors — no auto-reconnect (would wake the Ledger /
  spawn the Trezor popup on mount).
- **Adding a device:** subclass `BaseEvmHwProvider` (implement the three signing primitives) + a
  `createConnector` factory; add `src/<device>/index.ts` to the tsup `entry` and a `./<device>` export.

## Conventions

- Device SDKs (`@ledgerhq/*`) are marked `external` in tsup so they stay out of this package's bundle
  (the consumer's bundler pulls them in only when the Ledger entry is imported).
- **`moduleResolution: "Bundler"`** (not NodeNext, unlike the other packages): the `@ledgerhq/*` SDKs are
  CJS at runtime but ship `export default class` `.d.ts`. Under NodeNext those defaults resolve to a
  namespace and `new Eth()` / `Transport.create()` fail to type. Bundler resolution (matching the
  esbuild/Vite/webpack that actually consume this package) resolves them to the class. See `tsconfig.json`.
- `viem` / `wagmi` are **peer deps** (avoid duplicate instances — two wagmi copies break React context).
- ESM-only build (`.mjs` + `.d.ts`), matching `@sodax/wallet-sdk-react`. Sub-path exports: `.` and
  `./ledger` (add `./trezor`, `./keystone` as those land). No local `biome.json` — root config governs.

## Testing

Unit tests are **device-free**. Ledger: inject a fake `Eth` (canned `{ r, s, v }`); the tx test signs the
real digest with a test key so recovery yields the true sender end-to-end. Trezor: `vi.mock` the
`@trezor/connect-web` default export (set the mock data via `vi.hoisted` — `vi.mock` is hoisted above
top-level consts). Both use a fake `transports[chainId]` viem transport for canned RPC responses, and
assert request routing, message/typed-data signing, and the fill-sign-broadcast path (EIP-1559 + legacy).

> The on-hardware compatibility pass (connect a real Ledger in Chromium, sign on each chain) cannot run
> in CI — it is a manual step before any GA claim. See the feasibility doc §4/§6.

## Commands

```bash
pnpm --filter @sodax/wallet-hw test       # mocked unit tests
pnpm --filter @sodax/wallet-hw checkTs    # type check
pnpm --filter @sodax/wallet-hw build      # tsup ESM build
```
