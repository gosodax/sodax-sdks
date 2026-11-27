import { SPONSORING_API_ERROR_CODES, type SponsoringApiErrorCode } from '@sodax/types';
import { LOOKUP_CODES, type LookupErrorCode, type SodaxErrorCode } from '../errors/codes.js';
import { isCodeMember } from '../errors/guards.js';
import { createInvariant, type FeatureInvariant } from '../errors/invariant.js';
import type { SodaxError } from '../errors/SodaxError.js';
import { isBackendHttpError } from '../backendApi/api-utils.js';

export const sponsoringInvariant: FeatureInvariant = createInvariant('sponsoring');

export type SponsoringAction = 'activateStellarAccount';

export type SponsoringOrchestrationErrorCode = Extract<
  SodaxErrorCode,
  | 'USER_REJECTED'
  | 'VALIDATION_FAILED'
  | 'INTENT_CREATION_FAILED'
  | 'LOOKUP_FAILED'
  | 'EXTERNAL_API_ERROR'
  | 'EXECUTION_FAILED'
  | 'UNKNOWN'
>;

export type SponsoringConfigErrorCode = Extract<SodaxErrorCode, 'EXTERNAL_API_ERROR' | 'VALIDATION_FAILED' | 'UNKNOWN'>;

export type SponsoringLookupErrorCode = LookupErrorCode;

export type SponsoringOrchestrationError = SodaxError<SponsoringOrchestrationErrorCode>;
export type SponsoringConfigError = SodaxError<SponsoringConfigErrorCode>;
export type SponsoringLookupError = SodaxError<SponsoringLookupErrorCode>;

const ORCHESTRATION_CODES: ReadonlySet<SponsoringOrchestrationErrorCode> = new Set([
  'USER_REJECTED',
  'VALIDATION_FAILED',
  'INTENT_CREATION_FAILED',
  'LOOKUP_FAILED',
  'EXTERNAL_API_ERROR',
  'EXECUTION_FAILED',
  'UNKNOWN',
]);

const CONFIG_CODES: ReadonlySet<SponsoringConfigErrorCode> = new Set([
  'EXTERNAL_API_ERROR',
  'VALIDATION_FAILED',
  'UNKNOWN',
]);

export const isSponsoringOrchestrationError = isCodeMember<SponsoringOrchestrationErrorCode>(ORCHESTRATION_CODES);
export const isSponsoringConfigError = isCodeMember<SponsoringConfigErrorCode>(CONFIG_CODES);
export const isSponsoringLookupError = isCodeMember<SponsoringLookupErrorCode>(LOOKUP_CODES);

/** `rebuildAndResign` needs a new signature; `retrySameRequest` reuses the signed XDR; `backoff` waits first. */
export type SponsorFailureAction =
  | 'fixIntegration'
  | 'checkApiKey'
  | 'rebuildAndResign'
  | 'retrySameRequest'
  | 'backoff'
  | 'contactOperator'
  | 'abort';

export interface SponsorFailureClass {
  action: SponsorFailureAction;
  retryable: boolean;
  requiresNewSignature: boolean;
  /** Absent for transport failures, timeouts, and schema failures. */
  status?: number;
  /** Present only for a recognized domain code. */
  code?: SponsoringApiErrorCode;
  /** Human-readable only; do not use for control flow. */
  message: string;
  /** Server-provided backoff in seconds. */
  retryAfterSeconds?: number;
  /** Advisory sponsor sequence supplied on a conflict. */
  sponsorSequence?: string;
}

const DOMAIN_CODES: ReadonlySet<string> = new Set(SPONSORING_API_ERROR_CODES);

/** Distinguish domain codes from framework labels in the `error` field. */
function toDomainCode(value: unknown): SponsoringApiErrorCode | undefined {
  return typeof value === 'string' && DOMAIN_CODES.has(value) ? (value as SponsoringApiErrorCode) : undefined;
}

function readErrorBody(body: unknown): {
  message?: string;
  code?: SponsoringApiErrorCode;
  retryAfterSeconds?: number;
  sponsorSequence?: string;
} {
  if (typeof body !== 'object' || body === null) return {};
  const record = body as {
    message?: unknown;
    error?: unknown;
    retryAfterSeconds?: unknown;
    sponsorSequence?: unknown;
  };
  // Reject values that would busy-retry or wait forever.
  const retryAfterSeconds =
    typeof record.retryAfterSeconds === 'number' &&
    Number.isFinite(record.retryAfterSeconds) &&
    record.retryAfterSeconds > 0
      ? record.retryAfterSeconds
      : undefined;
  // The sequence is passed directly to the transaction builder.
  const sponsorSequence =
    typeof record.sponsorSequence === 'string' && /^\d+$/.test(record.sponsorSequence)
      ? record.sponsorSequence
      : undefined;
  return {
    message: typeof record.message === 'string' ? record.message : undefined,
    code: toDomainCode(record.error),
    retryAfterSeconds,
    sponsorSequence,
  };
}

const ACTION_POLICY = {
  fixIntegration: { retryable: false, requiresNewSignature: false },
  checkApiKey: { retryable: false, requiresNewSignature: false },
  rebuildAndResign: { retryable: true, requiresNewSignature: true },
  retrySameRequest: { retryable: true, requiresNewSignature: false },
  backoff: { retryable: true, requiresNewSignature: false },
  contactOperator: { retryable: false, requiresNewSignature: false },
  abort: { retryable: false, requiresNewSignature: false },
} as const satisfies Record<SponsorFailureAction, { retryable: boolean; requiresNewSignature: boolean }>;

function policy(
  action: SponsorFailureAction,
): Pick<SponsorFailureClass, 'action' | 'retryable' | 'requiresNewSignature'> {
  return { action, ...ACTION_POLICY[action] };
}

/** HTTP status is primary; recognized domain codes refine statuses whose handling differs by cause. */
export function classifySponsorError(error: SodaxError<'EXTERNAL_API_ERROR'>): SponsorFailureClass {
  // Preserve classification across duplicate SDK copies in one bundle.
  const cause = error.cause;
  const http = isBackendHttpError(cause) ? cause : undefined;
  const { message: serverMessage, code, retryAfterSeconds, sponsorSequence } = readErrorBody(http?.body);
  const message = serverMessage ?? error.message;
  const status = http?.status;

  // The request may not have reached the service.
  if (status === undefined) {
    return { ...policy('backoff'), message };
  }

  const base = { status, code, retryAfterSeconds, sponsorSequence, message };

  switch (status) {
    case 400:
      return { ...base, ...policy('fixIntegration') };
    case 401:
      return { ...base, ...policy('checkApiKey') };
    case 409:
      // The server reconciles by transaction hash before reporting a conflict.
      return { ...base, ...policy('rebuildAndResign') };
    case 422:
      return { ...base, ...policy('abort') };
    case 429:
      return { ...base, ...policy('backoff') };
    case 500:
      return { ...base, ...policy('contactOperator') };
    case 503:
      if (code === 'SPONSOR_BUDGET_EXHAUSTED') {
        return { ...base, ...policy('contactOperator') };
      }
      if (code === 'HORIZON_UNAVAILABLE') {
        // The signed envelope remains valid until its maxTime.
        return { ...base, ...policy('retrySameRequest') };
      }
      return { ...base, ...policy('backoff') };
    default:
      return { ...base, ...policy('abort') };
  }
}
