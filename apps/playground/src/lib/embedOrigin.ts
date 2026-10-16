/**
 * Resolves the origin of the page framing the widget so host messages never use a wildcard target.
 * Prefers `location.ancestorOrigins` (direct parent), then falls back to the document referrer.
 */
export function resolveHostOrigin(
  ancestorOrigins: ArrayLike<string> | undefined,
  referrer: string,
): string | undefined {
  const direct = ancestorOrigins?.[0];
  if (isHttpOrigin(direct)) return direct;
  try {
    const origin = new URL(referrer).origin;
    return isHttpOrigin(origin) ? origin : undefined;
  } catch {
    return undefined;
  }
}

function isHttpOrigin(value: string | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\/[^/]+$/.test(value);
}
