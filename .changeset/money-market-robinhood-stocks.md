---
'@sodax/types': minor
---

Add eleven Robinhood Stock Tokens to the money market as collateral: AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, SPCX, SPY, QQQ and GLD. Users can supply them and borrow other assets against them; borrowing the Stock Tokens themselves is disabled on the pool.

Their hub vaults join `moneyMarketHubVaults`, so they appear in `moneyMarketReserveAssets` (before `hubConfig.bnUSD`, which stays last) and in `moneyMarketSupportedTokens[SONIC_MAINNET]`. The Robinhood Chain, Stellar and Hedera representations are appended to those chains' money-market lists. The other Robinhood Stock Tokens stay swap-only, and existing list entries keep their order.
