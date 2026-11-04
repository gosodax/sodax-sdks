---
"@sodax/dapp-kit": patch
---

`useBridgeDetailedStatus` stops polling on the `source: 'mpcRelay'` arm `BridgeService.getDetailedStatus` now returns for an MPC-relay source (Tron). Like the relay arm, it only arrives once the deposit is minted on the hub, so it is terminal.
