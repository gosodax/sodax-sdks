---
"@sodax/sdk": patch
---

`sodax.spoke.xrp.canAffordTrustline` follows the XRP Ledger's reserve rule: an account owning fewer than two ledger objects needs only the network fee to set up a trustline, so a newly funded account is no longer asked for XRP the ledger does not require. The `no_trustline` and `trustline_limit` refusal messages now name `sodax.spoke.xrp.requestTrustline`.
