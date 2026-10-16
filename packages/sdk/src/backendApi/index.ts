// Re-export only the request-config TYPES that consumers depend on (e.g.
// @sodax/dapp-kit imports `RequestOverrideConfig`). These were public on `main`
// when they lived in BackendApiService.ts; the api-utils extraction must keep
// them exported. The runtime helper (`makeRequest`) stays package-internal —
// it was never part of the public API.
export type { ApiResponse, RequestConfig, RequestOverrideConfig } from './api-utils.js';
// Export the bundle-safe guard with the structured HTTP error.
export { BackendHttpError, isBackendHttpError } from './api-utils.js';
export * from './BackendApiService.js';
export { isFillEvent, isOracleCandleInterval, type FillEvent } from './guards.js';
// The oracle interval set is public data: `OracleMarketInterval.key` is `string`, so consumers
// membership-test it (or call `isOracleCandleInterval`) before passing it to `getOracleCandles`.
export { ORACLE_CANDLE_INTERVALS } from './backendApiSchemas.js';
export * from './SwapsApiService.js';
export * from './LeverageYieldApiService.js';
export * from './SponsoringApiService.js';
export * from './BridgeApiService.js';

// Re-export the swaps wire failure taxonomy from the wrapped @sodax/swaps-api client so consumers
// can narrow the failure `SwapsApiService` surfaces — `error.context.code` (a `SwapsApiErrorCode`)
// and the underlying `error.cause` (`SwapsApiError`) — without taking a direct dependency on
// @sodax/swaps-api. `SodaxErrorContext` keeps `context.code` typed `unknown` (it is the shared,
// feature-agnostic error bag), so importing this union is how callers type/switch on it.
export { SwapsApiError } from '@sodax/swaps-api';
export type { SwapsApiErrorCode, SwapsApiErrorContext } from '@sodax/swaps-api';

// Same for the bridge wire failure taxonomy from the wrapped @sodax/bridge-api client, which
// `BridgeApiService` surfaces the same way (`error.context.code` / `error.cause`).
export { BridgeApiError } from '@sodax/bridge-api';
export type { BridgeApiErrorCode, BridgeApiErrorContext } from '@sodax/bridge-api';
