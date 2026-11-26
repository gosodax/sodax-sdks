---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/wallet-sdk-core": minor
---

Add XRP Ledger trustlines, like Stellar's. `sodax.spoke.xrp.hasSufficientTrustline(token, amount, address)` checks that an account can receive an issued token, and `sodax.spoke.xrp.requestTrustline({ raw })` opens or raises the line with a NoRipple `TrustSet`, refusing before signing when the account cannot cover the new owner reserve. `IXrpWalletProvider` gains an optional `signTrustSet`, implemented by `XrpWalletProvider` for raw keys and GemWallet.
