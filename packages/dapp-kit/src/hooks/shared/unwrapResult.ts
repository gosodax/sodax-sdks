import type { Result } from '@sodax/sdk';

/** Returns `value` or throws `error`; non-`Error` failures are wrapped so consumers always get an `Error`. */
export function unwrapResult<T>(result: Result<T>): T {
  if (!result.ok) {
    if (result.error instanceof Error) throw result.error;
    const e = result.error as { message?: string; detail?: { code?: string; message?: string } };
    const msg = e?.detail?.code ?? e?.detail?.message ?? e?.message ?? 'SDK call failed';
    throw new Error(msg, { cause: result.error });
  }
  return result.value;
}
