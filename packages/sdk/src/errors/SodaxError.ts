import type { SodaxErrorCode, SodaxErrorContext, SodaxFeature } from './codes.js';

export type { SodaxErrorContext } from './codes.js';

export type SodaxErrorJSON<C extends SodaxErrorCode = SodaxErrorCode> = {
  name: string;
  code: C;
  feature: SodaxFeature;
  message: string;
  stack?: string;
  context?: SodaxErrorContext;
  cause?: unknown;
};

const MAX_CAUSE_DEPTH = 3;
const MAX_SANITIZE_DEPTH = 5;
const captureStackTrace = (Error as { captureStackTrace?: (target: object, ctor: unknown) => void }).captureStackTrace;

export class SodaxError<C extends SodaxErrorCode = SodaxErrorCode> extends Error {
  readonly code: C;
  readonly feature: SodaxFeature;
  override readonly cause?: unknown;
  readonly context?: SodaxErrorContext;

  constructor(
    code: C,
    message: string,
    options: { feature: SodaxFeature; cause?: unknown; context?: SodaxErrorContext },
  ) {
    super(message);
    this.name = 'SodaxError';
    this.code = code;
    this.feature = options.feature;
    this.cause = options.cause;
    this.context = options.context;
    captureStackTrace?.(this, SodaxError);
  }

  /**
   * Serialize via this (`JSON.stringify` calls it). Hardened against bigints, non-plain objects, context cycles
   * (depth 5) and deep cause chains (depth 3).
   */
  toJSON(): SodaxErrorJSON<C> {
    return {
      name: this.name,
      code: this.code,
      feature: this.feature,
      message: this.message,
      stack: this.stack,
      context: this.context ? sanitizeContext(this.context, 0) : undefined,
      cause: serializeCause(this.cause, 0),
    };
  }
}

/** Prefer over `instanceof`: stays correct when duplicate copies of `@sodax/sdk` exist in a bundle. */
export function isSodaxError(e: unknown): e is SodaxError {
  if (e instanceof SodaxError) return true;
  return (
    e instanceof Error &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { feature?: unknown }).feature === 'string' &&
    (e as { name?: unknown }).name === 'SodaxError'
  );
}

function serializeCause(cause: unknown, depth: number): unknown {
  if (cause === undefined || cause === null) return undefined;
  if (depth >= MAX_CAUSE_DEPTH) return '[max cause depth reached]';
  if (cause instanceof SodaxError) {
    return {
      name: cause.name,
      code: cause.code,
      feature: cause.feature,
      message: cause.message,
      stack: cause.stack,
      context: cause.context ? sanitizeContext(cause.context, 0) : undefined,
      cause: serializeCause(cause.cause, depth + 1),
    };
  }
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
      cause: 'cause' in cause ? serializeCause((cause as { cause?: unknown }).cause, depth + 1) : undefined,
    };
  }
  return safeString(cause);
}

function sanitizeContext(value: SodaxErrorContext, depth: number): SodaxErrorContext {
  const out: SodaxErrorContext = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = sanitizeValue(v, depth + 1);
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_SANITIZE_DEPTH) return '[max depth reached]';
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'bigint') return (value as bigint).toString();
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'function' || t === 'symbol') return safeString(value);
  if (Array.isArray(value)) return value.map(v => sanitizeValue(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return Array.from(value.entries()).map(([k, v]) => [sanitizeValue(k, depth + 1), sanitizeValue(v, depth + 1)]);
  }
  if (value instanceof Set) {
    return Array.from(value.values()).map(v => sanitizeValue(v, depth + 1));
  }
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return sanitizeContext(value as SodaxErrorContext, depth);
    }
    return safeString(value);
  }
  return safeString(value);
}

function safeString(v: unknown): string {
  try {
    return String(v);
  } catch {
    return '[unserializable]';
  }
}
