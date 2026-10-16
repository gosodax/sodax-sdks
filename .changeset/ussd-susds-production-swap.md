---
'@sodax/types': minor
---

Promote USSD, sodaUSSD, sodaSUSDS and sUSDS to the **production** swap token lists.

None of these were selectable in production: USSD and sodaSUSDS were staging-only, sodaUSSD was filtered out of the `SodaTokens` spread, and sUSDS was absent from both lists on every chain despite being a money-market reserve. So the SDK would not offer them and `isValidOriginalAssetAddress` had nothing to accept.

Each was verified against the production solver's `/quote` before promotion, since the list is meant to mirror what that solver can actually route: USSD 0.9967, sodaUSSD 0.9944 and sodaSUSDS 1.1006 per unit into sodaUSDC, and sUSDS ~1.098 on Arbitrum, Ethereum, Base and Optimism. `stagingSwapSupportedTokens[SONIC_MAINNET]` is now empty — everything it carried is in production, and staging still resolves the full set through `getStagingSolverTokens`.

**`sodaUSDS` is deliberately still excluded.** The production solver answers a quote against it with `No path was found`, so listing it would offer a swap that can only expire unfilled.
