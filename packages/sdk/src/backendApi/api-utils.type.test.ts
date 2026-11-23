/**
 * Compile-time contract for `api-utils.ts`: header helpers return plain header records, `withApiKey`
 * preserves the caller's config type, `makeRequest` returns its caller-chosen `T`, and both error
 * factories return `SodaxError<'EXTERNAL_API_ERROR'>`.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { BaseApiConfig, BackendHttpError, RequestConfig, SodaxError } from '../index.js';
import {
  type apiKeyHeader,
  type assignHeaders,
  isBackendHttpError,
  type MakeRequestParams,
  makeRequest,
  type mergeHeaders,
  resolveRequestConfig,
  type toExternalApiError,
  type toInvalidResponseShapeError,
  type toJsonBody,
  type trimTrailingSlashes,
  withApiKey,
} from './api-utils.js';

type Headers = Record<string, string>;

declare const baseConfig: BaseApiConfig;
declare const requestConfig: RequestConfig;
declare const params: MakeRequestParams;

describe('header helpers', () => {
  it('return a header record', () => {
    expectTypeOf<ReturnType<typeof apiKeyHeader>>().toEqualTypeOf<Headers>();
    expectTypeOf<ReturnType<typeof mergeHeaders>>().toEqualTypeOf<Headers>();
    expectTypeOf<ReturnType<typeof assignHeaders>>().toEqualTypeOf<void>();
  });

  it('withApiKey returns the exact config type it was given', () => {
    const onBase = () => withApiKey(baseConfig, 'key');
    const onLiteral = () => withApiKey({ headers: {}, basePath: '/v1', extra: 1 }, undefined);
    expectTypeOf<ReturnType<typeof onBase>>().toEqualTypeOf<BaseApiConfig>();
    expectTypeOf<ReturnType<typeof onLiteral>>().toEqualTypeOf<{ headers: {}; basePath: string; extra: number }>();
    const invalid = () => [
      // @ts-expect-error — the config must carry a `headers` record to merge the key into.
      withApiKey({ baseURL: 'https://x' }, 'key'),
    ];
    expectTypeOf(invalid).toBeFunction();
  });
});

describe('isBackendHttpError', () => {
  it('narrows to BackendHttpError', () => {
    expectTypeOf(isBackendHttpError).guards.toEqualTypeOf<BackendHttpError>();
    // Parsed JSON of a non-2xx body; the backend does not promise an error-body schema.
    expectTypeOf<BackendHttpError['body']>().toBeUnknown();
    expectTypeOf<BackendHttpError['status']>().toEqualTypeOf<number>();
  });
});

describe('string helpers', () => {
  it('return strings', () => {
    expectTypeOf<ReturnType<typeof trimTrailingSlashes>>().toEqualTypeOf<string>();
    expectTypeOf<ReturnType<typeof toJsonBody>>().toEqualTypeOf<string>();
  });
});

describe('makeRequest', () => {
  it('resolves to the caller-chosen body type', () => {
    // `T` appears only in the result, so it cannot be inferred; callers must name it.
    const typed = () => makeRequest<{ id: string }>(params);
    const untyped = () => makeRequest(params);
    expectTypeOf<ReturnType<typeof typed>>().toEqualTypeOf<Promise<{ id: string }>>();
    // Without a type argument the unchecked JSON body surfaces as `unknown` (reported).
    expectTypeOf<ReturnType<typeof untyped>>().toEqualTypeOf<Promise<unknown>>();
  });
});

describe('resolveRequestConfig', () => {
  it('returns a RequestConfig', () => {
    const call = () => resolveRequestConfig(requestConfig, { baseURL: 'https://x', timeout: 1, headers: {} });
    expectTypeOf<ReturnType<typeof call>>().toEqualTypeOf<RequestConfig>();
  });
});

describe('error factories', () => {
  it('return the external-API error', () => {
    expectTypeOf<ReturnType<typeof toExternalApiError>>().toEqualTypeOf<SodaxError<'EXTERNAL_API_ERROR'>>();
    expectTypeOf<ReturnType<typeof toInvalidResponseShapeError>>().toEqualTypeOf<SodaxError<'EXTERNAL_API_ERROR'>>();
  });
});
