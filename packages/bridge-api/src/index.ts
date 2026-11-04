// Public surface of @sodax/bridge-api.
export { BridgeApi } from './client.js';
export { BridgeApiError } from './errors.js';
export type { BridgeApiErrorCode, BridgeApiErrorContext } from './errors.js';
export type { BridgeApiConfig } from './config.js';
export { API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE } from './http.js';

// The backend Bridge API v2 contract, re-exported type-only so consumers can
// `import type { IBridgeApiV2 } from '@sodax/bridge-api'`.
export type { IBridgeApiV2 } from '@sodax/types';
