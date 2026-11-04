---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
---

Sync the Sonic hub vault token metadata in `SodaTokens` to the on-chain `symbol()` / `name()` of each vault contract.

Most vaults carry the underlying asset's symbol on-chain, so `SodaTokens.sodaBTC.symbol` is now `BTC` (was `sodaBTC`), `sodaWEETH` → `weETH`, `sodaSUSDS` → `sUSDS`, `sodaJITOSOL` → `JitoSOL`, and so on for AVAX, BNB, SOL, XLM, INJ, SUI, POL, HYPE, RBNT, LL, wstETH, NEAR, KAIA, STX, HBAR and USDS. Vaults whose contract keeps the prefix (`sodaETH`, `sodaWBTC`, `sodaUSDC`, `sodaUSDT`, `sodaS`, `sodaSODA`, `sodaUSSD`) are unchanged. `name` now matches the contract's `name()` for every entry.

The `SodaTokens` object keys, `HubVaultSymbols`, `HubVaultSymbol`, addresses, decimals and `LsodaTokens` are untouched, so `SodaTokens.sodaBTC` still resolves. The Stellar spoke tokens `sodaETH` / `sodaBTC` / `sodaBNB` are Soroban asset codes and keep their symbols. Consumers that looked tokens up by the old `soda*` symbol strings (for example `findSupportedTokenBySymbol(sonic, 'sodaBTC')`) or that mirrored `tokenLogo('sodaBTC')` paths should switch to the on-chain symbols; the now-unclaimed `soda*.png` logos were removed from `@sodax/assets`.
