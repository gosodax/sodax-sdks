// Public surface of @sodax/swaps-api.
export { SwapsApi } from './client.js';
export { SwapsApiError } from './errors.js';
export type { SwapsApiErrorCode, SwapsApiErrorContext } from './errors.js';
export type { SwapsApiConfig } from './config.js';
export { API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE } from './http.js';

// The backend Swaps API v2 contract, re-exported type-only so consumers can
// `import type { ISwapsApiV2 } from '@sodax/swaps-api'`.
export type { ISwapsApiV2 } from '@sodax/types';

// Response-validation schemas (valibot) + the per-chain raw-tx schema factory. Exposed so
// @sodax/sdk's leverage-yield feature can reuse the shared swaps intent / relay / gas / fee /
// submit-tx response shapes — a leverage-yield deposit/withdraw IS an intent-based swap — instead
// of re-declaring them. Leverage exposes `IntentStateSchema` under the name `IntentStateResponseSchema`.
export {
  // `IntentResponseSchema` / `RelayExtraDataResponseSchema` are internal building blocks in
  // schemas.ts; expose them under their public alias names (avoids a duplicate-export of the same
  // value, which knip flags).
  GetIntentResponseSchema as IntentResponseSchema,
  IntentExtraDataResponseSchema as RelayExtraDataResponseSchema,
  makeCreateIntentResponseSchema,
  makeApproveResponseSchema,
  makeQuoteResponseSchema,
  makeCancelIntentResponseSchema,
  DeadlineResponseSchema,
  AllowanceCheckResponseSchema,
  SubmitIntentResponseSchema,
  StatusResponseSchema,
  IntentHashResponseSchema,
  IntentPacketResponseSchema,
  IntentStateSchema,
  GasEstimateResponseSchema,
  FeeResponseSchema,
  SubmitTxResponseSchema,
  SubmitTxStatusResponseSchema,
} from './schemas.js';
export { rawTxSchemaForChainKey } from './rawTxSchemas.js';
