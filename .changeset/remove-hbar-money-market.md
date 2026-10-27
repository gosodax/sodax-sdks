---
'@sodax/types': patch
---

Remove HBAR from the money market. The lending pool has no HBAR reserve, so supplying or borrowing HBAR could not work.

Stellar HBAR is dropped from `moneyMarketSupportedTokens[STELLAR_MAINNET]`, and the HBAR hub vault from the Sonic list and from `moneyMarketReserveAssets`. HBAR swaps and bridging are unchanged. Since the HBAR vault is no longer a reserve asset, a swap's speed tier estimate no longer counts HBAR as a soda asset. Add HBAR back once its reserve is live.
