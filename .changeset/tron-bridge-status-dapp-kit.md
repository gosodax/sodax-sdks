---
"@sodax/dapp-kit": patch
---

`useBridgeDetailedStatus` stops polling on the `source: 'mpcRelay'` arm `BridgeService.getDetailedStatus` now returns for a bridge to or from an MPC-relay chain (Tron). Like the relay arm, it only arrives once its leg settles (the hub mint, or the release paid out), so it is terminal. Pass `dstChainKey` for a bridge from Tron. For a hub-only bridge pass Sonic. For a bridge to another spoke the hook waits for the hub-to-spoke packet. A not-delivered read the SDK tags `context.mpcRelay` gets a budget of 100 reads, about 5 minutes, instead of 40, because that relay settles more slowly, and a bridge to Tron starts a fresh budget once its first leg reaches the hub.
