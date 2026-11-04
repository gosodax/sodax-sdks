import type { SuiExecutionResult, SuiExecutionStatus, SuiPaginatedCoins } from './sui.js';

/**
 * Structural mirrors of the `client.core` responses in `@mysten/sui` 2.x, kept local so
 * `@sodax/types` stays dependency-free. Bump them in lockstep with the workspace catalog.
 */
export type SuiCoreCoin = {
  objectId: string;
  version: string;
  digest: string;
  balance: string;
};

export type SuiCoreListCoinsResponse = {
  objects: SuiCoreCoin[];
  hasNextPage: boolean;
  cursor: string | null;
};

export type SuiCoreExecutionStatus = { success: true; error: null } | { success: false; error: { message: string } };

export type SuiCoreCommandResult = {
  returnValues: { bcs: Uint8Array }[];
};

/**
 * `listCoins` reports `type` as the full `0x2::coin::Coin<T>` tag, so `coinType` echoes the
 * filter the caller queried with rather than unwrapping it.
 */
export function toSuiPaginatedCoins(response: SuiCoreListCoinsResponse, coinType: string): SuiPaginatedCoins {
  return {
    data: response.objects.map(coin => ({
      balance: coin.balance,
      coinObjectId: coin.objectId,
      coinType,
      digest: coin.digest,
      version: coin.version,
    })),
    hasNextPage: response.hasNextPage,
    nextCursor: response.cursor,
  };
}

export function toSuiExecutionResult(command: SuiCoreCommandResult): SuiExecutionResult {
  return {
    returnValues: command.returnValues.map(value => [Array.from(value.bcs), '']),
  };
}

export function toSuiExecutionStatus(status: SuiCoreExecutionStatus): SuiExecutionStatus {
  return status.success ? { status: 'success' } : { status: 'failure', error: status.error.message };
}
