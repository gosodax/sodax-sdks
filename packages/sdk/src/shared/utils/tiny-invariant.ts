const prefix: string = 'Invariant failed';

export function invariant(
  // biome-ignore lint/suspicious/noExplicitAny: any required for type inference
  condition: any,
  /** A function defers building a costly message. */
  message?: string | (() => string),
): asserts condition {
  if (condition) {
    return;
  }

  const provided: string | undefined = typeof message === 'function' ? message() : message;

  const value: string = provided ? `${prefix}: ${provided}` : prefix;
  throw new Error(value);
}

/** Like {@link invariant} but throws a lazily built caller error (e.g. a typed `SodaxError`) instead of a prefixed `Error`. */
export function assertOk<E extends Error>(
  // biome-ignore lint/suspicious/noExplicitAny: any required for type inference
  condition: any,
  makeError: () => E,
): asserts condition {
  if (condition) return;
  throw makeError();
}
