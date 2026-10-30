import { isAuthFailure, type Result } from '@sodax/sdk';

const ATTEMPTS = 10;
const INTERVAL_MS = 1_500;

/**
 * Re-checks an API allowance until it reports `valid`, for up to about 15 seconds. The API reads the chain
 * through its own RPC, which can trail the node that confirmed the approve by a few blocks; resolving on that
 * stale `valid: false` leaves Approve enabled after a successful approval. A failed check is retried like a
 * stale one, except an auth failure, which no retry fixes. Never throws: the approval has already landed, and
 * the caller's allowance refetch shows whatever the API reports last.
 */
export async function waitForApiAllowance(
  check: () => Promise<Result<{ valid: boolean }>>,
  { attempts = ATTEMPTS, intervalMs = INTERVAL_MS }: { attempts?: number; intervalMs?: number } = {},
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const result = await check().catch((error: unknown) => ({ ok: false as const, error }));
    if (result.ok ? result.value.valid : isAuthFailure(result.error)) return;
    if (attempt >= attempts) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}
