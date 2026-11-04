---
"@sodax/dapp-kit": patch
---

`useBridgeDetailedStatus` stops polling on the `source: 'mpcRelay'` arm `BridgeService.getDetailedStatus` now returns for a bridge to or from an MPC-relay chain (Tron). Like the relay arm, it only arrives once its leg settles (the hub mint, or the release paid out), so it is terminal.
