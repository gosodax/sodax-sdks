/** Poll `attempt` until it returns a value or `timeoutMs` of wall-clock time passes; `undefined` on timeout. */
export async function pollUntil<T>(
  attempt: () => Promise<T | undefined>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}
