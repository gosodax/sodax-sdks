import type { SuiExecutionResult, SuiExecutionStatus, SuiPaginatedCoins } from './sui.js';

// Local mirrors of `@mysten/sui` 2.x `client.core` responses (keeps this package dependency-free); bump with the catalog.
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

/** `listCoins` reports `type` as the full `0x2::coin::Coin<T>` tag, so `coinType` echoes the caller's filter instead. */
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
