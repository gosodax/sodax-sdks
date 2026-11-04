export type FriendlyError = {
  /** Safe to show as the headline — a category, never a raw revert dump. */
  message: string;
  /** First line of the underlying error, for the developer reading this playground. */
  detail?: string;
};

const CATEGORIES: readonly [RegExp, string][] = [
  [
    /user rejected|user denied|rejected the request|action_rejected|\b4001\b/,
    'You rejected the request in your wallet.',
  ],
  [/insufficient funds|exceeds balance|transfer amount exceeds/, 'Not enough balance to cover the amount plus gas.'],
  [/allowance|insufficient approval/, 'Token approval is missing or too low — approve before swapping.'],
  [/deadline|expired/, 'The quote expired. Fetch a fresh quote and try again.'],
  [/slippage|minoutput|minimum received/, 'The price moved past your slippage tolerance.'],
  [
    /rate limit|\b429\b|fetch failed|timeout|econnrefused|network request failed/,
    'Network or RPC problem. Retry in a moment.',
  ],
  [/chain mismatch|wrong chain|unsupported chain/, 'Your wallet is on the wrong network.'],
];

/**
 * Maps a thrown SDK / wallet error onto a short category plus a one-line detail. viem revert
 * messages are multi-line `Raw Call Arguments:` dumps, which are noise in a UI and leak internals.
 */
export function describeError(error: unknown, fallback: string): FriendlyError {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = raw.toLowerCase().replace(/[\s_]+/g, ' ');
  const message = CATEGORIES.find(([pattern]) => pattern.test(normalized))?.[1] ?? fallback;
  const detail = raw.split('\n')[0]?.trim().slice(0, 200) || undefined;

  return detail && detail !== message ? { message, detail } : { message };
}
