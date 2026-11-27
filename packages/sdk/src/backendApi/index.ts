// Only the request-config TYPES are public (dapp-kit uses `RequestOverrideConfig`); `makeRequest` stays internal.
export type { ApiResponse, RequestConfig, RequestOverrideConfig } from './api-utils.js';
export { BackendHttpError, isBackendHttpError } from './api-utils.js';
export * from './BackendApiService.js';
export { isFillEvent, isOracleCandleInterval, type FillEvent } from './guards.js';
export { ORACLE_CANDLE_INTERVALS } from './backendApiSchemas.js';
export * from './SwapsApiService.js';
export * from './LeverageYieldApiService.js';
export * from './SponsoringApiService.js';
export * from './BridgeApiService.js';

// Lets consumers type `error.context.code` / `error.cause` without depending on the wire packages directly.
export { SwapsApiError } from '@sodax/swaps-api';
export type { SwapsApiErrorCode, SwapsApiErrorContext } from '@sodax/swaps-api';

export { BridgeApiError } from '@sodax/bridge-api';
export type { BridgeApiErrorCode, BridgeApiErrorContext } from '@sodax/bridge-api';
