import type { SodaxLogger, SpokeChainKey, XToken } from '@sodax/types';

/** A wallet balance map in smallest units, keyed by `token.address`. */
export type WalletBalanceMap = Record<string, bigint>;

export type BalanceReadContext = {
  readonly logger: SodaxLogger;
  readonly chainKey: SpokeChainKey;
};

/**
 * Accumulates a chain's per-token balance reads.
 *
 * A token that could not be read resolves to `0n` — the same value an empty wallet produces — so
 * every failure is logged through the SDK logger, which is where an integrator's error sink is
 * wired. That keeps one flaky token from discarding the balances that did resolve, but it means a
 * caller cannot tell the two apart; {@link BalanceCollector.finish} therefore refuses the one case
 * where the distinction is unmistakable and dangerous: an entire batch that read nothing at all
 * (a dead or rate-limited RPC) would otherwise render as "this wallet is empty on every asset".
 */
export interface BalanceCollector {
  /** Record a balance that was actually read — including a genuine on-chain zero. */
  ok(tokenAddress: string, value: bigint): void;
  /** Record a failed read: logs the cause and falls back to `0n`. */
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

/**
 * Read every token independently into `collector`, so one failing token never discards the rest.
 * Chains with a native batch call (EVM multicall3, ICON `tryAggregate`, Injective portfolio) feed
 * the collector directly instead of using this.
 */
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
