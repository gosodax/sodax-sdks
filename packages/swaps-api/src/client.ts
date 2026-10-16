import type {
  CancelIntentRequestV2,
  CreateIntentParamsV2,
  CreateLimitOrderParamsV2,
  DeadlineQueryV2,
  FeeQueryV2,
  GasEstimateRequestV2,
  IntentExtraDataRequestV2,
  IntentHashRequestV2,
  IntentPacketRequestV2,
  ISwapsApiV2,
  QuoteQueryV2,
  QuoteRequestV2,
  StatusRequestV2,
  SubmitIntentRequestV2,
  SubmitTxRequestV2,
  SubmitTxStatusQueryV2,
} from '@sodax/types';
import * as v from 'valibot';
import type { SwapsApiConfig } from './config.js';
import { apiKeyHeader, mergeHeaders, type RequestContext, request } from './http.js';
import { rawTxSchemaForChainKey } from './rawTxSchemas.js';
import * as s from './schemas.js';
import { serializeBigints, serializeIntentRequest } from './serialize.js';

/** Endpoint paths. Path params are `encodeURIComponent`-escaped here so call sites stay drift-free. */
const PATHS = {
  tokens: '/swaps/tokens',
  tokensByChain: (chainKey: string) => `/swaps/tokens/${encodeURIComponent(chainKey)}`,
  quote: '/swaps/quote',
  deadline: '/swaps/deadline',
  allowanceCheck: '/swaps/allowance/check',
  approve: '/swaps/approve',
  intents: '/swaps/intents',
  intentsSubmit: '/swaps/intents/submit',
  intentsStatus: '/swaps/intents/status',
  intentsCancel: '/swaps/intents/cancel',
  intentsHash: '/swaps/intents/hash',
  intentsPacket: '/swaps/intents/packet',
  intentsExtraData: '/swaps/intents/extra-data',
  intentFill: (txHash: string) => `/swaps/intents/${encodeURIComponent(txHash)}/fill`,
  intent: (txHash: string) => `/swaps/intents/${encodeURIComponent(txHash)}`,
  limitOrders: '/swaps/limit-orders',
  gasEstimate: '/swaps/gas/estimate',
  feesPartner: '/swaps/fees/partner',
  feesSolver: '/swaps/fees/solver',
  submitTx: '/swaps/submit-tx',
  submitTxStatus: '/swaps/submit-tx/status',
} as const;

/**
 * Minimal HTTP client for the SODAX backend Swaps API.
 *
 * One thin method per `ISwapsApiV2` endpoint. Each method builds its request, runs any
 * `IntentRequestV2` body through {@link serializeIntentRequest}, and validates the response with a
 * valibot schema. All failures surface as a thrown `SwapsApiError`. `idempotent: true` marks the
 * read/poll/pure-compute calls that may be retried; mutating calls are not, except on an apiguard 503
 * (see `API_KEY_VERIFICATION_UNAVAILABLE_MESSAGE`).
 */
export class SwapsApi implements ISwapsApiV2 {
  private readonly ctx: RequestContext;

  constructor(config: SwapsApiConfig) {
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
      parse: raw => v.parse(s.GetSwapTokensResponseSchema, raw),
    });
  }

  getTokensByChain(chainKey: string) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.tokensByChain(chainKey),
      endpoint: 'getTokensByChain',
      idempotent: true,
      parse: raw => v.parse(s.GetSwapTokensByChainResponseSchema, raw),
    });
  }

  getQuote(body: QuoteRequestV2, query?: QuoteQueryV2) {
    const txSchema = rawTxSchemaForChainKey(body.tokenSrcChainKey);
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.quote,
      endpoint: 'getQuote',
      idempotent: true,
      // Only send the flag when truthy — a literal `?includeTxData=false` can read as truthy on a
      // backend that keys off param presence; absence is the unambiguous "off".
      query: { includeTxData: query?.includeTxData || undefined },
      body,
      parse: raw => v.parse(s.makeQuoteResponseSchema(txSchema), raw),
    });
  }

  getDeadline(query?: DeadlineQueryV2) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.deadline,
      endpoint: 'getDeadline',
      idempotent: true,
      query: { offsetSeconds: query?.offsetSeconds },
      parse: raw => v.parse(s.DeadlineResponseSchema, raw),
    });
  }

  checkAllowance(body: CreateIntentParamsV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.allowanceCheck,
      endpoint: 'checkAllowance',
      idempotent: true,
      body,
      parse: raw => v.parse(s.AllowanceCheckResponseSchema, raw),
    });
  }

  approve(body: CreateIntentParamsV2) {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.approve,
      endpoint: 'approve',
      body,
      parse: raw => v.parse(s.makeApproveResponseSchema(txSchema), raw),
    });
  }

  createIntent(body: CreateIntentParamsV2) {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.intents,
      endpoint: 'createIntent',
      body,
      parse: raw => v.parse(s.makeCreateIntentResponseSchema(txSchema), raw),
    });
  }

  submitIntent(body: SubmitIntentRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.intentsSubmit,
      endpoint: 'submitIntent',
      body,
      parse: raw => v.parse(s.SubmitIntentResponseSchema, raw),
    });
  }

  getStatus(body: StatusRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.intentsStatus,
      endpoint: 'getStatus',
      idempotent: true,
      body,
      parse: raw => v.parse(s.StatusResponseSchema, raw),
    });
  }

  cancelIntent(body: CancelIntentRequestV2) {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.intentsCancel,
      endpoint: 'cancelIntent',
      body: { srcChainKey: body.srcChainKey, intent: serializeIntentRequest(body.intent) },
      parse: raw => v.parse(s.makeCancelIntentResponseSchema(txSchema), raw),
    });
  }

  getIntentHash(body: IntentHashRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.intentsHash,
      endpoint: 'getIntentHash',
      idempotent: true,
      body: { intent: serializeIntentRequest(body.intent) },
      parse: raw => v.parse(s.IntentHashResponseSchema, raw),
    });
  }

  getSolvedIntentPacket(body: IntentPacketRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.intentsPacket,
      endpoint: 'getSolvedIntentPacket',
      idempotent: true,
      body,
      parse: raw => v.parse(s.IntentPacketResponseSchema, raw),
    });
  }

  getIntentSubmitTxExtraData(body: IntentExtraDataRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.intentsExtraData,
      endpoint: 'getIntentSubmitTxExtraData',
      idempotent: true,
      body: { txHash: body.txHash, intent: body.intent ? serializeIntentRequest(body.intent) : undefined },
      parse: raw => v.parse(s.IntentExtraDataResponseSchema, raw),
    });
  }

  getFilledIntent(txHash: string) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.intentFill(txHash),
      endpoint: 'getFilledIntent',
      idempotent: true,
      parse: raw => v.parse(s.IntentStateSchema, raw),
    });
  }

  getIntent(txHash: string) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.intent(txHash),
      endpoint: 'getIntent',
      idempotent: true,
      parse: raw => v.parse(s.GetIntentResponseSchema, raw),
    });
  }

  createLimitOrderIntent(body: CreateLimitOrderParamsV2) {
    const txSchema = rawTxSchemaForChainKey(body.srcChainKey);
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.limitOrders,
      endpoint: 'createLimitOrderIntent',
      body,
      parse: raw => v.parse(s.makeCreateIntentResponseSchema(txSchema), raw),
    });
  }

  estimateGas(body: GasEstimateRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.gasEstimate,
      endpoint: 'estimateGas',
      idempotent: true,
      // `tx` is chain-specific and may carry bigint numerics (e.g. an EVM `value` reused from a
      // create-intent response); deep-serialize them to decimal strings so the rejectBigint body
      // guard doesn't (correctly) trip on the natural build-tx → estimate-gas flow.
      body: serializeBigints(body),
      parse: raw => v.parse(s.GasEstimateResponseSchema, raw),
    });
  }

  getPartnerFee(query: FeeQueryV2) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.feesPartner,
      endpoint: 'getPartnerFee',
      idempotent: true,
      query: { amount: query.amount },
      parse: raw => v.parse(s.FeeResponseSchema, raw),
    });
  }

  getSolverFee(query: FeeQueryV2) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.feesSolver,
      endpoint: 'getSolverFee',
      idempotent: true,
      query: { amount: query.amount },
      parse: raw => v.parse(s.FeeResponseSchema, raw),
    });
  }

  submitTx(body: SubmitTxRequestV2) {
    return request(this.ctx, {
      method: 'POST',
      path: PATHS.submitTx,
      endpoint: 'submitTx',
      body: { ...body, intent: serializeIntentRequest(body.intent) },
      parse: raw => v.parse(s.SubmitTxResponseSchema, raw),
    });
  }

  getSubmitTxStatus(query: SubmitTxStatusQueryV2) {
    return request(this.ctx, {
      method: 'GET',
      path: PATHS.submitTxStatus,
      endpoint: 'getSubmitTxStatus',
      idempotent: true,
      query: { txHash: query.txHash, srcChainKey: query.srcChainKey },
      parse: raw => v.parse(s.SubmitTxStatusResponseSchema, raw),
    });
  }
}
