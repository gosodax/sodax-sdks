---
name: add-wallet-provider
description: 'Use when adding a WALLET to the SODAX SDK for a chain that is ALREADY integrated — a new wallet connector (another Bitcoin/Stellar/Icon/Injective/NEAR/Stacks browser wallet, or a hardware wallet) in wallet-sdk-react, or a new signing-config variant on an existing wallet-sdk-core provider. NOT for integrating a brand-new chain (use the add-chain skill). Triggers on "add a wallet", "support <wallet> wallet", "add a connector", "new XConnector", "add Ledger/Phantom/Unisat/Leather", "hardware wallet", "add mnemonic/private-key mode to <chain> provider". The wallet layer is two slices: wallet-sdk-core signer providers and wallet-sdk-react connectors.'
---

# Adding a Wallet to the SODAX SDK

> Verify every class, base, and registry slot against current `src/` before copying — the wallet
> layer refactors. This skill adds a wallet to an **already-integrated chain**. A brand-new chain
> (new `ChainType` + its own SpokeService — e.g. Aleo) is the **add-chain** skill instead; it picks
> the chain's first connector from the same pattern table below.

## First: which case?

| You are adding… | Where | Section |
| --- | --- | --- |
| A new **wallet connector** for an existing chain (another browser wallet, a hardware wallet) | `wallet-sdk-react` only | **Case A** |
| A new **signing-config variant** on an existing core provider (e.g. add a mnemonic mode) | `wallet-sdk-core` only | **Case B** |
| A whole **new chain** (its first provider + connector) | all packages | **STOP → `add-chain`** |

The wallet layer is two independent slices: **wallet-sdk-core** signs/broadcasts (`I<Chain>WalletProvider` over `BaseWalletProvider`); **wallet-sdk-react** connects the browser wallet (`XConnector`) and exposes it to React via `chainRegistry.ts`. Most "add a wallet" tasks are Case A.

## Case A — a new wallet for an existing chain (`wallet-sdk-react` only)

**First read the chain's `chainRegistry.ts` entry and match its *shape* — the names below are examples, so a chain not listed still maps by its registry shape, and it decides whether you write a new class at all:**

| Chain(s) | Pattern | Add a wallet by |
| --- | --- | --- |
| Bitcoin, Icon | one `XConnector` subclass **per wallet**, listed in `defaultConnectors` | write `<Wallet>XConnector` (extend the chain's connector base) **and** add `new <Wallet>XConnector(defaults)` to the array |
| Injective, Stacks | **one** connector class, multiple parameterized **instances** | add an instance — Injective `new InjectiveXConnector('Name', Wallet.X)`, Stacks add to `STACKS_PROVIDERS` — usually **no new class** |
| Stellar, NEAR | runtime **discovery** via an aggregator (`discoverConnectors`) | the wallet set comes from the Stellar Wallets Kit / NEAR wallet-selector — support is added through the aggregator, not a hand-written connector |
| EVM, Solana, Sui | **provider-managed** (native SDK) | not Case A — see the caveat |

**Writing a connector** (Bitcoin / Icon pattern): `src/xchains/<chain>/<Wallet>XConnector.ts` extending the chain's connector base (e.g. `BitcoinXConnector`, itself extending `XConnector`). Implement the base's abstract methods — for Bitcoin: `connect()`, `disconnect()`, `getWalletProvider()`, `recreateWalletProvider(xAccount)` — plus `isInstalled` / `installUrl`. It builds the matching `I<Chain>WalletProvider` from `wallet-sdk-core`, forwarding `this.defaults`. Keep the connector `id` and install metadata **stable** — they key persisted connections and the modal.

**Tests** — `<Wallet>XConnector.test.ts` covering `connect` / `disconnect` / `isInstalled` / `installUrl`; extend `chainRegistry.test.ts` only if registry behavior changed.

**Provider-managed caveat (EVM / Solana / Sui):** their connectors come from the native SDK (wagmi / wallet-adapter) through the `providers/<chain>/` Hydrator — `defaultConnectors` is `[]` and ignored. To support another EVM wallet, add it through the native connector config (a wagmi connector, or `EVM.walletConnect`), not a new `XConnector`.

## Case B — a new signing variant on an existing core provider

`wallet-sdk-core` only, when the chain already works but you need another credential mode (e.g. add a mnemonic alongside the private key).

1. `src/wallet-providers/<chain>/types.ts` — extend the config discriminated union with the new variant. When the credential is not a plain private key, follow the `SecretInjectiveWalletConfig` nested-credential pattern, not a new `PrivateKey*` literal.
2. `<Chain>WalletProvider.ts` — handle the new config branch in the constructor (`super(walletConfig.defaults)`); keep `getWalletAddress()` and signing methods intact.
3. `<Chain>WalletProvider.test.ts` — add the new constructor-variant case.

See `wallet-sdk-core/AGENTS.md` → "Adding a New Chain Provider" / "Config variants" for the full provider shape.

## Docs
Docs Drift CI fails unless a related publishable site surface changed with `src/`. Update `packages/wallet-sdk-react/docs/` (Case A) or `packages/wallet-sdk-core/README.md` (Case B). If `packages/types/src` changed too, note that neither of those covers it — update a mapped `packages/sdk/docs/` page such as `WALLET_PROVIDERS.md`, since the `types` README passes the gate but does not publish. JSDoc is not enough. If you add a brand-new published page, add it to `scripts/docs-pages-map.json` and give it a nav entry in `docs/docs.json`, or it is live but absent from the sidebar and search; a page not ready to go live goes on the map's `unpublished` list instead. `packages/skills` is partner-agent docs (how integrators connect/sign) — update it when that public surface changed, then run `pnpm check:ai`; it does not satisfy Docs Drift. An unrelated mapped file (for example `packages/skills/README.md`) does not satisfy a wallet-package source change.

## Verify
- Case A: `cd packages/wallet-sdk-react && pnpm test && pnpm checkTs`. Case B: `cd packages/wallet-sdk-core && pnpm test && pnpm checkTs`.
- Confirm the connector base's abstract method set in `src/xchains/<chain>/<Chain>XConnector.ts` before implementing — it differs by family.
- `instanceof` must survive barrel/deep imports — import the connector base from the same path the registry uses.

> Worked example: a new Bitcoin connector — [`references/example-bitcoin-connector.md`](references/example-bitcoin-connector.md).
