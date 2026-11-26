---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/wallet-sdk-core": minor
"@sodax/wallet-sdk-react": minor
"@sodax/dapp-kit": major
---

Let a user set up the XRP Ledger trustline a swap into an issued token needs, instead of only being refused before signing.

**Breaking (`@sodax/dapp-kit`):** `SwapSetupReason` gains `xrpTrustline`, `xrpFunding`, `xrpBlocked` and `xrpCheckFailed`, so an exhaustive `switch` over `useSwapLifecycle`'s `needsSetup` reason needs those cases.

- `@sodax/sdk` — `sodax.spoke.xrp.requestTrustline({ srcAddress, token, walletProvider | raw })` sends one TrustSet with the largest limit XRPL represents and NoRipple, which fixes both a missing trustline and one without room, and resolves to a `Result` once it validates; `raw: true` returns the unsigned TrustSet. `canAffordTrustline({ address, token })` checks the spendable XRP for the fee plus, for a new line, one owner reserve, and `requiresTrustline(token)` tells an issued token from native XRP. `SOLVED_PAYOUT_HEADROOM_FACTOR` is now exported, so a caller can size `checkDestination`'s `maxAmount` as the SDK does.
- `@sodax/types` — `XrpUnsignedTrustSet` and the optional `IXrpWalletProvider.signTrustSet`. A provider without it cannot set up trustlines, and `requestTrustline` refuses it.
- `@sodax/wallet-sdk-core` — `XrpWalletProvider.signTrustSet` signs locally in raw-key mode and submits through GemWallet, on the XRPL Mainnet only, in browser mode. `GemWalletLike` gains the optional `submitTrustSet`.
- `@sodax/wallet-sdk-react` — the GemWallet connector passes `submitTrustSet` through.
- `@sodax/dapp-kit` — `useSwapLifecycle` gates an XRPL issued-token destination: `xrpTrustline` runs the TrustSet from `next()`, `xrpFunding` asks for spendable XRP, `xrpBlocked` covers refusals no trustline fixes (read `lifecycle.xrp.blockedReason`), and `xrpCheckFailed` retries. New hooks `useXrpGate`, `useXrpDestinationCheck`, `useXrpTrustlineReserveCheck` and `useEstablishXrpTrustline`, and the resolver `resolveXrpGate`.
