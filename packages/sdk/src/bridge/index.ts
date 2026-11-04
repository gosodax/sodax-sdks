export * from './BridgeService.js';
// The `getDetailedStatus` contract. `DetailedBridgeStatus` is discriminated on `source`, so it
// needs no narrowing helpers. `DETAILED_STATUS_NOT_DELIVERED` is deliberately NOT re-exported here
// — the root barrel already publishes it through the swap barrel, and a second path to the same
// name would be an ambiguous star export.
export type { DetailedBridgeStatus, DetailedBridgeStatusKey } from './detailedStatus.js';
export * from './errors.js';
