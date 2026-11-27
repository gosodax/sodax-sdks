import type { SodaxLogger, SpokeChainKey, XToken } from '@sodax/types';

/** Smallest units, keyed by `token.address`. */
export type WalletBalanceMap = Record<string, bigint>;

export type BalanceReadContext = {
  readonly logger: SodaxLogger;
  readonly chainKey: SpokeChainKey;
};

/**
 * A failed read resolves to `0n` (logged), indistinguishable from an empty wallet, so {@link BalanceCollector.finish}
 * refuses a batch that read nothing at all (a dead or rate-limited RPC) rather than report every asset as empty.
 */
export interface BalanceCollector {
  /** Record a balance actually read, including a genuine on-chain zero. */
  ok(tokenAddress: string, value: bigint): void;
  /** Logs the cause and falls back to `0n`. */
  fail(tokenAddress: string, reason: unknown): void;
  /** Return the map, or throw when a non-empty batch produced no successful read. */
  finish(): WalletBalanceMap;
}

export function createBalanceCollector({ logger, chainKey }: BalanceReadContext): BalanceCollector {
  const balances: WalletBalanceMap = {};
  let attempted = 0;
  let failed = 0;

  return {
    ok(tokenAddress, value) {
      attempted++;
      balances[tokenAddress] = value;
    },
    fail(tokenAddress, reason) {
      attempted++;
      failed++;
      logger.warn('[getWalletBalances] balance read failed, reporting 0n', {
        chainKey,
        token: tokenAddress,
        error: reason instanceof Error ? reason.message : String(reason),
      });
      balances[tokenAddress] = 0n;
    },
    finish() {
      if (attempted > 0 && failed === attempted) {
        throw new Error(`[getWalletBalances] every balance read failed on ${chainKey} (${failed}/${attempted})`);
      }
      return balances;
    },
  };
}

/** Reads each token independently; chains with a native batch call feed the collector directly instead. */
export async function settleWalletBalances(
  collector: BalanceCollector,
  tokens: readonly XToken[],
  read: (token: XToken) => Promise<bigint>,
): Promise<void> {
  const settled = await Promise.allSettled(tokens.map(token => read(token)));

  tokens.forEach((token, index) => {
    const outcome = settled[index];
    if (!outcome) return;
    if (outcome.status === 'fulfilled') {
      collector.ok(token.address, outcome.value);
    } else {
      collector.fail(token.address, outcome.reason);
    }
  });
}
