import type { SuiGasEstimate } from '../common/common.js';
import type { SuiExecutionResult, SuiPaginatedCoins, SuiRawTransactionReceipt, SuiTransaction } from './sui.js';

export type SuiWaitForTransactionParams = {
  digest: string;
  timeoutMs: number;
  pollingIntervalMs: number;
};

/**
 * Implemented by `SuiGrpcTransport` in `@sodax/sdk`. Uses `SuiTransaction`, not `@mysten/sui`'s `Transaction`, so the
 * SDK's published `.d.ts` (no node10 resolution fallback) never names the vendor client.
 */
export interface SuiTransport {
  readonly endpoint: string;
  getCoins(owner: string, coinType: string, limit?: number, cursor?: string | null): Promise<SuiPaginatedCoins>;
  /** The sender is applied to the simulated tx, which may be a rebuilt copy — do not rely on `tx` coming back mutated. */
  simulate(tx: SuiTransaction, sender: string): Promise<SuiExecutionResult>;
  /** Same sender rule as {@link SuiTransport.simulate}. */
  estimateGas(tx: SuiTransaction, sender: string): Promise<SuiGasEstimate>;
  fetchLatestPackageId(objectId: string): Promise<string>;
  waitForTransaction(params: SuiWaitForTransactionParams): Promise<SuiRawTransactionReceipt>;
}
