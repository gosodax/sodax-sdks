---
'@sodax/sdk': minor
'@sodax/dapp-kit': minor
'@sodax/skills': patch
---

Respect the ICX migration contract's reverse-swap switch. `IcxMigrationService` gains `isReverseMigrationEnabled()`, which reads `reverseSwapEnabled` on the hub. When the switch is off, the ICX revert `approve`, `createRevertSodaToIcxMigrationIntent` and `revertMigrateSodaToIcx` now fail fast with `VALIDATION_FAILED` (`context.reason: 'reverse migration disabled'`). Before, they sent a transaction that reverted on-chain and surfaced as a generic `INTENT_CREATION_FAILED`, after the user had already paid for the approval.

`@sodax/dapp-kit` gains `useIcxReverseMigrationEnabled` so a UI can hide or disable SODA → ICX before asking for an approval.
