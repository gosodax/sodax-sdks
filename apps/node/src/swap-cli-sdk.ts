import { Sodax, SolverIntentStatusCode, type EvmChainKey, type SpokeChainKey } from '@sodax/sdk';
import type { Hex } from '@sodax/types';

/** Configure SDK RPC reads for the source chain. */
export function createSwapSdk(chainKey: EvmChainKey, rpcUrl?: `http${string}`): Sodax {
  return new Sodax(rpcUrl ? { chains: { [chainKey]: { rpcUrl } } } : undefined);
}

type SwapSettlement = Pick<Sodax['swaps'], 'getStatus' | 'waitForIntentDelivery'>;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Poll the solver for the hub fill transaction. */
async function waitForFill(
  swaps: Pick<SwapSettlement, 'getStatus'>,
  hubTxHash: string,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<string | null> {
  let notFound = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await swaps.getStatus({ intent_tx_hash: hubTxHash as Hex });
    if (status.ok) {
      const { status: code, fill_tx_hash } = status.value;
      if (code === SolverIntentStatusCode.SOLVED) {
        console.log(`[${attempt}] Solved.${fill_tx_hash ? ` Fill tx: ${fill_tx_hash}` : ''}`);
        if (!fill_tx_hash) console.error('The solver reported SOLVED without a fill transaction hash.');
        return fill_tx_hash || null;
      }
      if (code === SolverIntentStatusCode.FAILED) {
        console.log(`[${attempt}] The solver reported the swap as FAILED.`);
        return null;
      }
      if (code === SolverIntentStatusCode.NOT_FOUND && ++notFound >= 3) {
        console.log(`[${attempt}] The solver has no record of this intent. Check the hub tx hash manually.`);
        return null;
      }
      console.log(`[${attempt}] Still processing (solver status ${code})...`);
    } else {
      console.log(`[${attempt}] Status check failed, retrying:`, status.error);
    }
    await sleep(intervalMs);
  }
  console.log('Gave up waiting for a final status. The swap may still complete; check the hub tx hash.');
  return null;
}

/** Wait for the solver fill and the destination payout. */
export async function settleSwap(
  { swaps }: { swaps: SwapSettlement },
  dstChainKey: SpokeChainKey,
  hubTxHash: string,
): Promise<number> {
  const fillTxHash = await waitForFill(swaps, hubTxHash);
  if (!fillTxHash) return 1;

  const delivery = await swaps.waitForIntentDelivery({ chainId: dstChainKey, fillTxHash });
  if (!delivery.ok) {
    console.error('Destination delivery failed:', delivery.error);
    return 1;
  }

  console.log(`Destination tx: ${delivery.value.dstTxHash}`);
  return 0;
}
