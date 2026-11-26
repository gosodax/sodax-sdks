---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/wallet-sdk-react": patch
---

Add 47 Robinhood tokenized stocks on the XRP Ledger (asset ids 0x0004 to 0x0032, NVDA through ANT) as staging-only swap tokens.

`xrpSupportedTokens` registers each live stock flagged `isRwa`, 8 decimals, pointing at its existing Sonic equity vault with the XRPL wrapped asset as `hubAsset`. They are listed in `stagingSwapSupportedTokens` for XRP, not in the production list, until the production solver prices them. They are not money-market assets. Each has a zero MPC relay payout minimum, like the other XRPL tokens.

The stocks all share one XRPL issuer, so an issuer-only `address` could not tell them apart: the XRPL spoke would have resolved every stock to the first one in the list, and the three-letter tickers (GME, DJT, ...) would have used the standard 3-character currency instead of the 160-bit code they were issued with. Stocks therefore use the address `<40-hex currency>:<issuer>`, the same shape as the relay's `XRP_TOKEN_MAP` key. `xrpTokenRef` resolves either form to a (currency, issuer) pair, and `XrpSpokeService` (deposit amount, balance read, release preflight) and the wallet-sdk-react `XrpXService` balance read use it. RLUSD and USDC keep their issuer-only address and behave exactly as before.
