---
"@sodax/types": minor
"@sodax/sdk": minor
"@sodax/dapp-kit": minor
---

Add the leverage-yield vault `lsodaSUSDS` (sUSDS collateral / USSD borrow, eMode 3 "RWAStable Loop") to the SDK registry.

Registers the deployed `LeverageYieldVault` proxy on the Sonic hub at `0x758532F160D9D338bf662A4a59BA31a5B918A7cb` as `LsodaTokens.lsodaSUSDS`, and adds the matching entry to `leverageYieldVaults` (`asset: sodaSUSDS`, `borrowToken: sodaUSSD`). It's now discoverable via `sodax.leverageYield.getVault('lsodaSUSDS')` / `getVaultByAddress(...)`, and the `lsodaSUSDS` share token is spread into the Sonic supported-token and swap registries like the other `lsoda*` vaults.

Includes an `lsdSource` for the Sky Savings Rate (DefiLlama pool `d8c4eff5-c8a9-46fc-a888-057c4c668e72`, `fallbackAprPct: 3.5`) so `getEffectiveApr` reports the sUSDS native savings yield that AAVE's `currentLiquidityRate` does not capture.
