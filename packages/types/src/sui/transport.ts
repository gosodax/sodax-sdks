import type { SuiGasEstimate } from '../common/common.js';
import type { SuiExecutionResult, SuiPaginatedCoins, SuiRawTransactionReceipt, SuiTransaction } from './sui.js';

export type SuiWaitForTransactionParams = {
  digest: string;
  timeoutMs: number;
  pollingIntervalMs: number;
};

/**
 * Sui reads in `@sodax/types` vocabulary, implemented by `SuiGrpcTransport` in `@sodax/sdk`. It
 * speaks `SuiTransaction` rather than a `@mysten/sui` `Transaction` so this package stays
 * dependency-free and the SDK's published `.d.ts` — which has no node10 resolution fallback —
 * never names the vendor client.
 */
export interface SuiTransport {
  readonly endpoint: string;
  getCoins(owner: string, coinType: string, limit?: number, cursor?: string | null): Promise<SuiPaginatedCoins>;
  /**
   * The sender is applied to the transaction the node simulates, which may be a rebuilt copy of the
   * one passed in — do not rely on your instance coming back mutated.
   */
  simulate(tx: SuiTransaction, sender: string): Promise<SuiExecutionResult>;
  /** Same sender rule as {@link SuiTransport.simulate}. */
  estimateGas(tx: SuiTransaction, sender: string): Promise<SuiGasEstimate>;
  fetchLatestPackageId(objectId: string): Promise<string>;
  waitForTransaction(params: SuiWaitForTransactionParams): Promise<SuiRawTransactionReceipt>;
}
