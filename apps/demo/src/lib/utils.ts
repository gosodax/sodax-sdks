import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import BigNumber from 'bignumber.js';
import {
  type Sodax,
  SolverIntentStatusCode,
  supportedSpokeChains,
  spokeChainConfig,
  type XToken,
  type SpokeChainKey,
  type ChainKey,
  baseChainInfo,
  RadfiApiError,
} from '@sodax/dapp-kit';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function scaleTokenAmount(amount: number | string, decimals: number): bigint {
  // Return 0n if amount is NaN (for both string and number types)
  if (
    (typeof amount === 'number' && Number.isNaN(amount)) ||
    (typeof amount === 'string' && (amount.trim() === '' || Number.isNaN(Number(amount))))
  ) {
    return 0n;
  }
  return BigInt(
    new BigNumber(amount.toString()).multipliedBy(new BigNumber(10).pow(decimals)).toFixed(0, BigNumber.ROUND_DOWN),
  );
}

export function normaliseTokenAmount(amount: number | string | bigint, decimals: number): string {
  return new BigNumber(amount.toString())
    .dividedBy(new BigNumber(10).pow(decimals))
    .toFixed(decimals, BigNumber.ROUND_DOWN);
}

/**
 * Restate a raw amount from one decimals base to another. A bridge moves the same nominal value,
 * so the two sides differ only in scale — and a gate that compares across chains (Stellar's
 * trustline check works in stroops) needs the destination's base, not the source's.
 *
 * Downscaling truncates: a positive amount below the destination asset's smallest unit floors to
 * `0n`. Callers must reject that amount rather than forward it to a gate that reads `0n` as "no
 * amount" (`enabled: !!amount`) and skips the check.
 */
export function rescaleTokenAmount(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return amount;
  return fromDecimals > toDecimals
    ? amount / 10n ** BigInt(fromDecimals - toDecimals)
    : amount * 10n ** BigInt(toDecimals - fromDecimals);
}

export function formatTokenAmount(amount: number | string | bigint, decimals: number, displayDecimals = 2): string {
  return new BigNumber(amount.toString())
    .dividedBy(new BigNumber(10).pow(decimals))
    .toFixed(displayDecimals, BigNumber.ROUND_DOWN);
}

/**
 * Truncates a number to at most `decimals` fractional digits **without rounding**.
 * Use this instead of `Number.toFixed()` for values that feed into calculations or form inputs,
 * where rounding up could cause "exceeds max" errors.
 */
export function truncateToDecimals(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0';
  if (decimals === 0) return String(Math.trunc(value));
  const scaleFactor = 10 ** decimals;
  const truncatedValue = Math.trunc(value * scaleFactor) / scaleFactor;
  const fixedString = truncatedValue.toFixed(decimals);
  return fixedString.replace(/\.?0+$/, '') || '0';
}

/**
 * Expand a numeric string in scientific notation (e.g. "5.54e-8") to a plain decimal string
 * ("0.0000000554"). JS `number.toString()` emits sci-notation for |x| < 1e-6, which the
 * decimal-string parsers here (they split on '.') would otherwise mis-read — taking the mantissa
 * and silently dropping the exponent. Plain decimal strings pass through unchanged.
 */
export function expandExponential(value: string): string {
  if (!/e/i.test(value)) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

/**
 * Truncates a decimal string to at most maxDecimals fractional digits (no rounding).
 * Trims trailing zeros. For non-zero values that truncate to "0" (e.g. 0.00005 with 4 decimals),
 * returns a "< threshold" hint instead so the user knows the value is small but non-zero.
 */
export function formatDecimalForDisplay(value: string, maxDecimals: number): string {
  const trimmedInput = expandExponential(value.trim());
  // Reject empty or non-numeric input
  if (trimmedInput === '') return '0';
  const num = Number.parseFloat(trimmedInput);
  if (!Number.isFinite(num)) return '0';
  if (trimmedInput === '0') return '0';
  // Use trimmedInput (not value) so spaces and edge cases are handled consistently.
  const [intPart, fracPart = ''] = trimmedInput.split('.');
  const truncated = fracPart.slice(0, maxDecimals);
  const combined = truncated.length > 0 ? `${intPart}.${truncated}` : intPart;
  const trimmed = combined.replace(/\.?0+$/, '');

  // Tiny positive value that truncates to "0" → show "<0.00...1" so user sees it's non-zero.
  if (trimmed === '0' && num > 0) {
    const threshold = `0.${'0'.repeat(Math.max(0, maxDecimals - 1))}1`;
    return `<${threshold}`;
  }

  if (trimmed === '-0' || (trimmed.startsWith('-0.') && /^-0\.?0*$/.test(trimmed))) {
    return '0';
  }
  return trimmed;
}

/**
 * Safely truncates a decimal string for "Max" form-fill without rounding up.
 *
 * Purpose:
 * - Keep the value parseable by `parseUnits` while avoiding floating-point rounding that could
 *   produce a value slightly greater than the true max (and fail "exceeds max" validation ).
 *
 * Behavior:
 * - If `value` has a fractional part, keep the first non-zero fractional digit plus a few extra
 *   digits (default: +3), with a minimum number of decimals (default: 6).
 * - Trims trailing zeros and removes the trailing dot if needed.
 */
export function getSafeMaxAmountForInput(
  value: string,
  {
    minDecimals = 6,
    extraDecimalsAfterFirstNonZero = 3,
  }: { minDecimals?: number; extraDecimalsAfterFirstNonZero?: number } = {},
): string {
  const trimmed = expandExponential(value.trim());
  if (trimmed === '') return '';

  const dotIndex = trimmed.indexOf('.');
  if (dotIndex < 0) return trimmed;

  const intPart = trimmed.slice(0, dotIndex);
  const fracPart = trimmed.slice(dotIndex + 1);

  const firstNonZero = fracPart.search(/[1-9]/);
  const decimalsFromFirstNonZero = firstNonZero < 0 ? minDecimals : firstNonZero + 1 + extraDecimalsAfterFirstNonZero;
  const decimalPlaces = Math.max(minDecimals, decimalsFromFirstNonZero);

  const next = `${intPart}.${fracPart.slice(0, decimalPlaces)}`;
  return next.replace(/\.?0+$/, '');
}

export function calculateExchangeRate(amount: BigNumber, toAmount: BigNumber): BigNumber {
  return new BigNumber(1).dividedBy(amount).multipliedBy(toAmount);
}

export function statusCodeToMessage(status: SolverIntentStatusCode): string {
  switch (status) {
    case SolverIntentStatusCode.NOT_FOUND:
      return 'NOT_FOUND';
    case SolverIntentStatusCode.NOT_STARTED_YET:
      return 'NOT_STARTED_YET';
    case SolverIntentStatusCode.SOLVED:
      return 'SOLVED';
    case SolverIntentStatusCode.STARTED_NOT_FINISHED:
      return 'STARTED_NOT_FINISHED';
    case SolverIntentStatusCode.FAILED:
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

// Helper function to format seconds for display
export function formatSeconds(seconds: bigint): string {
  return Number(seconds).toLocaleString();
}

// Helper function to calculate time remaining for unstaking
export function getTimeRemaining(startTime: bigint, unstakingPeriod: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const start = Number(startTime);
  const period = Number(unstakingPeriod);
  const elapsed = now - start;
  const remaining = period - elapsed;

  if (remaining <= 0) {
    return 'Ready to claim';
  }

  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m remaining`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  }
  return `${minutes}m remaining`;
}

export function BigIntMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Formats a large number into a compact, human-readable form.
 * Examples:
 *  - 2450000 → "2.45M"
 *  - 1180 → "1.18K"
 *  - 9520000000 → "9.52B"
 */
export function formatCompactNumber(value: string | number | bigint): string {
  const num = typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number.parseFloat(value) : value;

  if (!Number.isFinite(num)) return '-';

  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(4).replace(/\.?0+$/, '')}B`;

  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(4).replace(/\.?0+$/, '')}M`;

  if (num >= 1_000) return `${(num / 1_000).toFixed(4).replace(/\.?0+$/, '')}K`;

  return num.toFixed(4);
}

export function getReadableTxError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Something went wrong. Please try again.';
  }

  const e = error as Record<string, string>;
  const raw = e?.shortMessage || e?.details || e?.message || '';
  // viem appends the whole calldata to `details`/`message`. Through a hub-wallet route that is
  // several hundred bytes of hex nobody can act on, and it buried the one sentence that could be
  // read. Everything before it is viem's own summary, so cutting there loses nothing.
  const message = raw.split('Raw Call Arguments:')[0]?.trim() || raw;

  if (message.includes('gas price below minimum')) {
    return 'Network gas fee is too low. Please try again in a moment.';
  }

  if (message.includes('User rejected')) {
    return 'Transaction was rejected in your wallet.';
  }

  return message || 'Transaction failed. Please try again.';
}

/**
 * Human-readable text from mutation failures (`mutateAsyncSafe` `result.error` or thrown values).
 * Appends `Error.cause` when present so SDK-wrapped errors stay debuggable.
 */
export function formatMutationFailureMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    // A Bound Exchange API failure carries the human-readable text on `details`; its
    // top-level `message` is only an i18n key. Prefer `details` whether the error is the
    // RadfiApiError itself or wrapped as the `cause` of a SodaxError.
    const radfi = error instanceof RadfiApiError ? error : cause instanceof RadfiApiError ? cause : undefined;
    if (radfi) return radfi.details ?? radfi.message;
    // SDK wrappers copy `cause.message` onto the SodaxError, so the two are often identical;
    // only append the cause when it adds new text to avoid "X — X" duplication.
    const causeText = cause instanceof Error && cause.message !== error.message ? ` — ${cause.message}` : '';
    return `${error.message}${causeText}`;
  }
  return fallback;
}

export function createDexTokenIdsStorageKey(chainId: SpokeChainKey, userAddress: string): string {
  return `sodax-dex-positions-${chainId}-${userAddress}`;
}

export function saveTokenIdToLocalStorage(userAddress: string, chainId: SpokeChainKey, tokenId: string): void {
  const cleanId = tokenId.trim().toLowerCase();
  const positions = getTokenIdsFromLocalStorage(chainId, userAddress);

  const hasDuplicate = positions.some(id => id.trim().toLowerCase() === cleanId);

  if (!hasDuplicate) {
    positions.push(tokenId.trim());
    localStorage.setItem(createDexTokenIdsStorageKey(chainId, userAddress), positions.join(','));
  } else {
    console.warn(`Token ID ${tokenId} already exists for user ${userAddress}`);
  }
}

export function getTokenIdsFromLocalStorage(chainId: SpokeChainKey, userAddress: string): string[] {
  const positions = localStorage.getItem(createDexTokenIdsStorageKey(chainId, userAddress));
  if (!positions) {
    return [];
  }
  return positions.split(',').map(v => v.trim());
}

export function removeTokenIdFromLocalStorage(chainId: SpokeChainKey, userAddress: string, tokenId: string): void {
  const positions = getTokenIdsFromLocalStorage(chainId, userAddress);
  if (!positions) {
    return;
  }
  if (positions.includes(tokenId)) {
    positions.splice(positions.indexOf(tokenId), 1);
    localStorage.setItem(createDexTokenIdsStorageKey(chainId, userAddress), positions.join(','));
  } else {
    console.warn(`Token ID ${tokenId} not found for user ${userAddress}`);
  }
}

export function clearTokenIdsFromLocalStorage(userAddress: string): void {
  localStorage.removeItem(`sodax-dex-positions-${userAddress}`);
}

/**
 * `tone` names what the state MEANS, so a caller can colour it by meaning rather than by reusing
 * `className`. The brand palette has no green, so `text-cherry-soda` had been standing in for
 * "good" and reading as a warning — same brick red as a real problem. Callers that want colour to
 * mean only "act on this" can drop the class on `safe` and keep the label.
 */
export function getHealthFactorState(hf: number) {
  if (hf < 1) {
    return { label: 'At risk', className: 'text-negative', tone: 'danger' as const };
  }
  if (hf < 2) {
    return { label: 'Moderate Risk', className: 'text-yellow-dark', tone: 'caution' as const };
  }
  return { label: 'Low Risk', className: 'text-cherry-soda', tone: 'safe' as const };
}

export function getChainsWithThisToken(sodax: Sodax, token: XToken) {
  return supportedSpokeChains.filter(chainId =>
    sodax.moneyMarket.getSupportedTokensByChainId(chainId).some(t => t.symbol === token.symbol),
  );
}

export function getTokenOnChain(sodax: Sodax, symbol: string, chainId: SpokeChainKey): XToken | undefined {
  return sodax.moneyMarket.getSupportedTokensByChainId(chainId).find(t => t.symbol === symbol);
}

export const getChainExplorerTxUrl = (chainId: string, txHash: string): string | undefined => {
  const chain = baseChainInfo[chainId as ChainKey];
  if (!chain) return undefined;
  return `${chain.explorer.txUrl}${txHash}`;
};
export function formatCurrencyCompact(value: number): string {
  const abs = Math.abs(value);

  if (abs < 1000) {
    return `$${value.toLocaleString()}`;
  }

  if (abs < 1_000_000) {
    const num = (value / 1000).toFixed(1);
    return `$${trimZeros(num)}K`;
  }

  const num = (value / 1_000_000).toFixed(2);
  return `$${trimZeros(num)}M`;
}

function trimZeros(num: string) {
  return num.replace(/\.?0+$/, '');
}

export function isTxHash(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && value.startsWith('0x');
}

/** Max length of appended RPC/revert text inside MM error alerts (keeps UI readable). */
const MM_ERROR_RAW_DETAIL_MAX_LEN = 900;

/**
 * Extracts a human-readable message from the nested `data.error` field of a MoneyMarketError.
 * Handles viem error objects, plain Error instances, and strings.
 */
function extractInnerErrorMessage(dataError: unknown): string | undefined {
  if (!dataError) return undefined;
  if (typeof dataError === 'string') return dataError;
  if (dataError instanceof Error) return (dataError as { shortMessage?: string }).shortMessage ?? dataError.message;
  if (typeof dataError === 'object') {
    const e = dataError as { shortMessage?: string; message?: string; details?: string };
    return e.shortMessage ?? e.message ?? e.details;
  }
  return undefined;
}

/**
 * Walks `Error.cause`, viem-style `details`, and `{ success, error }` shapes so simulation errors
 * are not lost when the outer message is only "Simulation failed".
 */
function collectNestedErrorText(dataError: unknown, maxDepth = 6): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();

  const collectErrorMessages = (node: unknown, depth: number): void => {
    if (depth > maxDepth || node == null) return;
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed.length > 0) parts.push(trimmed);
      return;
    }
    if (seen.has(node)) return;
    seen.add(node);

    if (node instanceof Error) {
      const trimmed = node.message.trim();
      if (trimmed.length > 0) parts.push(trimmed);
      collectErrorMessages(node.cause, depth + 1);
      return;
    }

    if (typeof node === 'object') {
      const errorObj = node as Record<string, unknown>;
      if (typeof errorObj.error === 'string' && errorObj.error.trim().length > 0) parts.push(errorObj.error.trim());
      if (errorObj.error != null && typeof errorObj.error !== 'string') collectErrorMessages(errorObj.error, depth + 1);
      if (typeof errorObj.details === 'string' && errorObj.details.trim().length > 0)
        parts.push(errorObj.details.trim());
      if (typeof errorObj.message === 'string' && errorObj.message.trim().length > 0)
        parts.push(errorObj.message.trim());
      if (typeof errorObj.shortMessage === 'string' && errorObj.shortMessage.trim().length > 0)
        parts.push(errorObj.shortMessage.trim());
      if ('cause' in errorObj) collectErrorMessages(errorObj.cause, depth + 1);
    }
  };

  collectErrorMessages(dataError, 0);
  return [...new Set(parts)].join('\n');
}

/** Full searchable text from `data.error` for substring checks and optional display. */
function getMmDataErrorSearchableText(dataError: unknown): string {
  const nested = collectNestedErrorText(dataError);
  if (nested.length > 0) return nested;
  return extractInnerErrorMessage(dataError) ?? '';
}

/** Checks whether the inner error message matches any of the given substrings (case-insensitive). */
function innerErrorIncludes(msg: string | undefined, ...needles: string[]): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return needles.some(n => lower.includes(n.toLowerCase()));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatHubSimulationFailureMessage(action: string, errorCode: string, dataError: unknown): string {
  const raw = getMmDataErrorSearchableText(dataError);
  const rawTrunc = raw.length > MM_ERROR_RAW_DETAIL_MAX_LEN ? `${raw.slice(0, MM_ERROR_RAW_DETAIL_MAX_LEN)}…` : raw;

  const lines = [
    `${capitalize(action)} simulation failed on hub chain (Sonic).`,
    '',
    'Possible causes:',
    '• Health factor: withdrawing collateral with active borrows.',
    '• Insufficient pool liquidity (high utilization).',
    '• Rounding / dust amount issues.',
    '',
    'Try a smaller amount or repay debt first.',
    '',
    `SDK error code: ${errorCode}`,
  ];

  if (rawTrunc.length > 0) {
    lines.push('', 'Detail:', rawTrunc);
  }

  return lines.join('\n');
}

export function getMmErrorText(error: unknown): string {
  if (typeof error === 'string') return error;

  // Money Market errors are now SodaxError<MoneyMarketErrorCode> from the SDK. Discriminate
  // on `error.code` (canonical, exposed as a string literal). The original lower-level
  // failure is preserved on `error.cause` (e.g. a viem revert, a fetch error, etc.).
  // Legacy fallback: if a plain Error reaches here (from non-canonical paths like a stray
  // throw outside SodaxError), use `error.message` as the code surrogate so older flows
  // still produce useful copy.
  let code: string | undefined;
  let causeError: unknown;
  let topLevelMessage: string | undefined;

  if (error instanceof Error) {
    const sodaxLike = error as { code?: unknown; cause?: unknown };
    code = typeof sodaxLike.code === 'string' ? sodaxLike.code : error.message;
    causeError = sodaxLike.cause;
    topLevelMessage = error.message;
  } else if (error && typeof error === 'object') {
    const obj = error as { code?: unknown; message?: unknown };
    code = typeof obj.code === 'string' ? obj.code : undefined;
    topLevelMessage = typeof obj.message === 'string' ? obj.message : undefined;
  }

  const searchableText = getMmDataErrorSearchableText(causeError);
  const innerMsg = extractInnerErrorMessage(causeError);

  // ── Relay errors ──
  if (code === 'MM_RELAY_TIMEOUT') {
    return 'Transaction timed out while waiting for relay. The transaction may still be processing. Please check the transaction status on the explorer.';
  }
  if (code === 'MM_SUBMIT_TX_FAILED') {
    return 'Failed to submit transaction to relay. Please try again.';
  }
  if (code === 'MM_RELAY_FAILED') {
    return 'Relay failed; cannot determine packet status. Please verify the transaction status on the explorer before retrying.';
  }
  if (code === 'MM_VERIFY_FAILED') {
    return 'Could not verify the transaction on the source chain. Please retry shortly.';
  }

  // ── Intent creation failures (simulation reverts) ──
  if (
    code === 'MM_SUPPLY_INTENT_CREATION_FAILED' ||
    code === 'MM_BORROW_INTENT_CREATION_FAILED' ||
    code === 'MM_WITHDRAW_INTENT_CREATION_FAILED' ||
    code === 'MM_REPAY_INTENT_CREATION_FAILED'
  ) {
    const action = code.replace('MM_', '').replace('_INTENT_CREATION_FAILED', '').toLowerCase();

    if (innerErrorIncludes(searchableText, 'insufficient funds for gas', 'exceeds the balance of the account')) {
      return `Not enough native token to cover gas fees for the ${action} transaction. Please top up your wallet.`;
    }
    if (innerErrorIncludes(searchableText, 'External call failed', 'Simulation failed', 'Execution reverted')) {
      return formatHubSimulationFailureMessage(action, code, causeError);
    }
    if (innerErrorIncludes(searchableText, 'user rejected', 'User denied', 'user cancelled')) {
      return 'Transaction was rejected in your wallet.';
    }
    return searchableText || innerMsg || `${capitalize(action)} transaction could not be created. (SDK code: ${code})`;
  }

  // ── Per-op catch-all errors ──
  if (
    code === 'MM_SUPPLY_FAILED' ||
    code === 'MM_BORROW_FAILED' ||
    code === 'MM_WITHDRAW_FAILED' ||
    code === 'MM_REPAY_FAILED'
  ) {
    const action = code.replace('MM_', '').replace('_FAILED', '').toLowerCase();

    if (innerErrorIncludes(searchableText, 'insufficient funds for gas', 'exceeds the balance of the account')) {
      return `Not enough native token to cover gas fees for the ${action} transaction. Please top up your wallet.`;
    }
    if (innerErrorIncludes(searchableText, 'External call failed', 'Simulation failed', 'Execution reverted')) {
      return formatHubSimulationFailureMessage(action, code, causeError);
    }
    if (innerErrorIncludes(searchableText, 'user rejected', 'User denied', 'user cancelled')) {
      return 'Transaction was rejected in your wallet.';
    }
    return searchableText || innerMsg || `${capitalize(action)} failed unexpectedly. (SDK code: ${code})`;
  }

  // ── Validation / approve / allowance / gas ──
  if (code === 'MM_VALIDATION_FAILED') return topLevelMessage ?? 'Invalid input.';
  if (code === 'MM_APPROVE_FAILED') return topLevelMessage ?? 'Approval failed. Please try again.';
  if (code === 'MM_ALLOWANCE_CHECK_FAILED') return topLevelMessage ?? 'Failed to check allowance. Please try again.';
  if (code === 'MM_GAS_ESTIMATION_FAILED') return topLevelMessage ?? 'Gas estimation failed.';

  return topLevelMessage ?? code ?? String(error);
}

/**
 * Gets the native token symbol for a given chain ID (e.g., ETH for Arbitrum, AVAX for Avalanche).
 * Used for displaying gas fee requirements to users.
 */
export function getNativeTokenSymbol(chainId: SpokeChainKey): string {
  const config = spokeChainConfig[chainId as SpokeChainKey];
  if (!config) return 'native token';

  // Find the token with address matching nativeToken (0x0000... for EVM chains)
  const nativeTokenAddress = config.nativeToken;
  const nativeToken = Object.values(config.supportedTokens).find(
    token => token.address.toLowerCase() === nativeTokenAddress.toLowerCase(),
  );

  return nativeToken?.symbol ?? 'native token';
}

/**
 * Format a WAD-scaled health factor. AAVE returns `type(uint256).max` when an account has
 * no debt — display that as `∞` instead of a giant number.
 *
 * Shared by the leverage-yield vault view and the leverage-position panel; both read WAD
 * health factors from the same pool.
 */
export function fmtHealthFactor(hfWad: bigint | undefined, digits = 2): string {
  if (hfWad === undefined) return '—';
  const UINT256_MAX = (1n << 256n) - 1n;
  if (hfWad >= UINT256_MAX - 1n) return '∞';
  const SCALE = 100_000n;
  const scaled = (hfWad * SCALE) / 1_000_000_000_000_000_000n;
  return (Number(scaled) / Number(SCALE)).toFixed(digits);
}

/** Format a basis-points value (e.g. `8500n`) as a percentage string. */
export function fmtBps(value: bigint | undefined, digits = 2): string {
  if (value === undefined) return '—';
  return `${(Number(value) / 100).toFixed(digits)}%`;
}
