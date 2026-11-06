import type { OutboundSettlement, SpokeChainKey } from '@sodax/dapp-kit';

export function extractTxHash(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const directCandidate =
    (result as { txHash?: unknown; hash?: unknown }).txHash ?? (result as { txHash?: unknown; hash?: unknown }).hash;

  if (typeof directCandidate === 'string' && directCandidate.length > 0) {
    return directCandidate;
  }

  const pair = result as { srcChainTxHash?: unknown; dstChainTxHash?: unknown };
  const candidate = pair.srcChainTxHash ?? pair.dstChainTxHash;
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }

  return undefined;
}

/**
 * The tx to show for a settled borrow or withdraw, and the chain it is on. A withdraw-auth from Tron has
 * no source tx, only the relay's trackingId, which no explorer knows: show its destination tx instead.
 */
export function settledTx(
  result: OutboundSettlement<SpokeChainKey>,
  { srcChainKey, dstChainKey }: { srcChainKey: SpokeChainKey; dstChainKey: SpokeChainKey },
): { txHash: string; txChainId: SpokeChainKey } {
  return 'trackingId' in result
    ? { txHash: result.dstChainTxHash, txChainId: dstChainKey }
    : { txHash: result.srcChainTxHash, txChainId: srcChainKey };
}
