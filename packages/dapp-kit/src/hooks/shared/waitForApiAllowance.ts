import { isAuthFailure, type RequestOverrideConfig, type Result } from '@sodax/sdk';

const BUDGET_MS = 15_000;
const INTERVAL_MS = 1_500;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Settles like `promise`, or with `undefined` once `ms` pass first. */
async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<undefined>(resolve => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-checks an API allowance until it reports `valid`, for at most 15 seconds in total. The API reads the chain
 * through its own RPC, which can trail the node that confirmed the approve by a few blocks; resolving on that
 * stale `valid: false` leaves Approve enabled after a successful approval. A failed check is retried like a
 * stale one, except an auth failure, which no retry fixes. Each check gets `apiConfig` with its request timeout
 * capped to the time left and is abandoned when that runs out, so a hanging API cannot stretch the wait. Never
 * throws: the approval has already landed, and the caller's allowance refetch shows whatever the API reports last.
 */
export async function waitForApiAllowance(
  check: (config: RequestOverrideConfig) => Promise<Result<{ valid: boolean }>>,
  apiConfig?: RequestOverrideConfig,
  { budgetMs = BUDGET_MS, intervalMs = INTERVAL_MS }: { budgetMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const remaining = deadline - Date.now();
    const timeout = Math.min(apiConfig?.timeout ?? remaining, remaining);
    const result = await settleWithin(
      check({ ...apiConfig, timeout }).catch((error: unknown) => ({ ok: false as const, error })),
      remaining,
    );
    if (!result || (result.ok ? result.value.valid : isAuthFailure(result.error))) return;
    // Skip a pause that would leave no time for another check.
    if (deadline - Date.now() <= intervalMs) return;
    await sleep(intervalMs);
  }
}
