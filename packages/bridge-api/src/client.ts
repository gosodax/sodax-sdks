import type {
  BridgeFeeRequestV2,
  BridgeQuoteRequestV2,
  BridgeSubmitTxRequestV2,
  BridgeSubmitTxStatusQueryV2,
  CreateBridgeIntentParamsV2,
  IBridgeApiV2,
} from '@sodax/types';
import * as v from 'valibot';
import type { BridgeApiConfig } from './config.js';
import { apiKeyHeader, mergeHeaders, type RequestContext, request } from './http.js';
import { rawTxSchemaForChainKey } from './rawTxSchemas.js';
import * as s from './schemas.js';

/** Endpoint paths. Path params are `encodeURIComponent`-escaped here so call sites stay drift-free. */
const PATHS = {
  tokens: '/bridge/tokens',
  tokensByChain: (chainKey: string) => `/bridge/tokens/${encodeURIComponent(chainKey)}`,
  allowanceCheck: '/bridge/allowance/check',
  approve: '/bridge/approve',
  intents: '/bridge/intents',
  submitTx: '/bridge/submit-tx',
  submitTxStatus: '/bridge/submit-tx/status',
  fee: '/bridge/fee',
  bridgeableAmount: '/bridge/bridgeable-amount',
  bridgeableCheck: '/bridge/bridgeable/check',
} as const;

/**
 * Minimal HTTP client for the SODAX backend Bridge API.
 *
 * One thin method per `IBridgeApiV2` endpoint. The bridge wire DTOs are fully string-typed, so
 * bodies go out as-is; every response is validated with a valibot schema (tx-bearing responses are
 * validated per source chain and transformed back to their domain shape). All failures surface as
 * a thrown `BridgeApiError`. `idempotent: true` marks the read/poll/pure-compute calls that may be
 * retried; mutating calls are not, except on an apiguard 503
 * (see `API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE`).
 */
export class BridgeApi implements IBridgeApiV2 {
  private readonly ctx: RequestContext;

  constructor(config: BridgeApiConfig) {
    this.ctx = {
      baseUrl: config.baseUrl,
      // Bind the global default so it works in browsers (where unbound fetch throws). A
      // caller-provided fetch is used as-is — they own its binding.
      fetchImpl: config.fetch ?? globalThis.fetch.bind(globalThis),
      // The `apiKey` convenience option expands first so an explicit `x-api-key` header wins, in any
      // casing — see `mergeHeaders`.
      defaultHeaders: mergeHeaders(apiKeyHeader(config.apiKey), config.headers),
      timeout: config.timeout,
    };
  }

  getTokens() {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.tokens,
      endpoint: 'getTokens',
      idempotent: true,
      parse: raw => v.parse(s.BridgeTokensResponseSchema, raw),
    });
  }

  getTokensByChain(chainKey: string) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.tokensByChain(chainKey),
      endpoint: 'getTokensByChain',
      idempotent: true,
      parse: raw => v.parse(s.BridgeTokensByChainResponseSchema, raw),
    });
  }

  checkAllowance(body: CreateBridgeIntentParamsV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.allowanceCheck,
      endpoint: 'checkAllowance',
      idempotent: true,
      body,
      parse: raw => v.parse(s.BridgeAllowanceCheckResponseSchema, raw),
    });
  }

  approve(body: CreateBridgeIntentParamsV2) {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.approve,
      endpoint: 'approve',
      body,
      parse: raw => v.parse(s.makeBridgeApproveResponseSchema(txSchema), raw),
    });
  }

  createBridgeIntent(body: CreateBridgeIntentParamsV2) {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.intents,
      endpoint: 'createBridgeIntent',
      body,
      parse: raw => v.parse(s.makeCreateBridgeIntentResponseSchema(txSchema), raw),
    });
  }

  submitTx(body: BridgeSubmitTxRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.submitTx,
      endpoint: 'submitTx',
      body,
      parse: raw => v.parse(s.BridgeSubmitTxResponseSchema, raw),
    });
  }

  getSubmitTxStatus(query: BridgeSubmitTxStatusQueryV2) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.submitTxStatus,
      endpoint: 'getSubmitTxStatus',
      idempotent: true,
      query: { txHash: query.txHash, srcChainKey: query.srcChainKey },
      parse: raw => v.parse(s.BridgeSubmitTxStatusResponseSchema, raw),
    });
  }

  getFee(body: BridgeFeeRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.fee,
      endpoint: 'getFee',
      idempotent: true,
      body,
      parse: raw => v.parse(s.BridgeFeeResponseSchema, raw),
    });
  }

  getBridgeableAmount(body: BridgeQuoteRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.bridgeableAmount,
      endpoint: 'getBridgeableAmount',
      idempotent: true,
      body,
      parse: raw => v.parse(s.BridgeableAmountResponseSchema, raw),
    });
  }

  isBridgeable(body: BridgeQuoteRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.bridgeableCheck,
      endpoint: 'isBridgeable',
      idempotent: true,
      body,
      parse: raw => v.parse(s.BridgeableCheckResponseSchema, raw),
    });
  }
}
