---
"@sodax/wallet-sdk-react": patch
---

Fix `useXSignMessage` on Bitcoin, which threw instead of signing.

The BITCOIN `signMessage` action in `chainRegistry.ts` applied the `hasSignBip322` / `hasSignEcdsa` guards to the `XConnector`, but `signBip322Message` and `signEcdsaMessage` live on the wallet provider (`IBitcoinWalletProvider`) — no built-in connector exposes them. Every call therefore failed the guard and threw `<id> does not support BIP-322 signing` before reaching the wallet. The action now resolves the wallet provider the way the neighbouring `createWalletProvider` does — the live one from `connect()`, falling back to `recreateWalletProvider` after a page reload — and guards that.

Affects all four built-in Bitcoin connectors (Unisat, Xverse, OKX, Hana) on every address type. The lower-level wallet-provider path was never affected.
