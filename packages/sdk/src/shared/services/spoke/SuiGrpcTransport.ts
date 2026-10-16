import type { SuiClientTypes } from '@mysten/sui/client';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  type SuiExecutionResult,
  type SuiGasEstimate,
  type SuiObjectOwner,
  type SuiPaginatedCoins,
  type SuiRawTransactionReceipt,
  type SuiTransaction,
  type SuiTransactionEffects,
  type SuiTransport,
  type SuiWaitForTransactionParams,
  toSuiExecutionResult,
  toSuiExecutionStatus,
  toSuiPaginatedCoins,
} from '@sodax/types';
import { toMystenTransaction } from '../../utils/sui-utils.js';

const DEFAULT_GET_COINS_LIMIT = 10;
/** Every deposit build waits on this read, so bound it instead of inheriting the runtime's default. */
const LATEST_PACKAGE_ID_TIMEOUT_MS = 10_000;

function toSuiObjectOwner(owner: SuiClientTypes.ObjectOwner | null): SuiObjectOwner {
  switch (owner?.$kind) {
    case 'AddressOwner':
      return { AddressOwner: owner.AddressOwner };
    case 'ObjectOwner':
      return { ObjectOwner: owner.ObjectOwner };
    case 'Shared':
      return { Shared: { initial_shared_version: owner.Shared.initialSharedVersion } };
    default:
      return 'Immutable';
  }
}

function toSuiTransactionEffects(
  effects: SuiClientTypes.TransactionEffects,
  executedEpoch: string,
): SuiTransactionEffects {
  const gasObject = effects.gasObject;
  return {
    messageVersion: 'v1',
    status: toSuiExecutionStatus(effects.status),
    executedEpoch,
    gasUsed: effects.gasUsed,
    transactionDigest: effects.transactionDigest,
    gasObject: {
      owner: toSuiObjectOwner(gasObject?.outputOwner ?? null),
      reference: {
        objectId: gasObject?.objectId ?? '',
        version: gasObject?.outputVersion ?? '',
        digest: gasObject?.outputDigest ?? '',
      },
    },
    dependencies: effects.dependencies,
    eventsDigest: effects.eventsDigest,
  };
}

export class SuiGrpcTransport implements SuiTransport {
  public readonly endpoint: string;
  private readonly client: SuiGrpcClient;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    // Only mainnet is supported — `spokeChainConfig` has a single Sui chain key. `network` feeds
    // the client's default Move Registry URL, which nothing here uses.
    this.client = new SuiGrpcClient({ network: 'mainnet', baseUrl: endpoint });
  }

  async getCoins(
    owner: string,
    coinType: string,
    limit: number = DEFAULT_GET_COINS_LIMIT,
    cursor?: string | null,
  ): Promise<SuiPaginatedCoins> {
    const response = await this.client.core.listCoins({ owner, coinType, limit, cursor: cursor ?? undefined });
    return toSuiPaginatedCoins(response, coinType);
  }

  async simulate(tx: SuiTransaction, sender: string): Promise<SuiExecutionResult> {
    const transaction = await toMystenTransaction(tx);
    transaction.setSenderIfNotSet(sender);
    // `checksEnabled: false` is what `devInspectTransactionBlock` did: it lets public non-entry
    // Move functions be called with no gas coin.
    const result = await this.client.core.simulateTransaction({
      transaction,
      include: { commandResults: true },
      checksEnabled: false,
    });

    const command = result.commandResults?.[0];
    if (!command) {
      throw new Error(`transaction didn't return any values: ${JSON.stringify(result, null, 2)}`);
    }
    return toSuiExecutionResult(command);
  }

  async estimateGas(tx: SuiTransaction, sender: string): Promise<SuiGasEstimate> {
    const transaction = await toMystenTransaction(tx);
    transaction.setSenderIfNotSet(sender);
    const result = await this.client.core.simulateTransaction({ transaction, include: { effects: true } });

    const effects = (result.Transaction ?? result.FailedTransaction)?.effects;
    if (!effects) {
      throw new Error('Transaction simulation returned no effects');
    }
    return effects.gasUsed;
  }

  async fetchLatestPackageId(objectId: string): Promise<string> {
    let object: SuiClientTypes.Object<{ json: true }>;
    try {
      ({ object } = await this.client.core.getObject({
        objectId,
        include: { json: true },
        signal: AbortSignal.timeout(LATEST_PACKAGE_ID_TIMEOUT_MS),
      }));
    } catch (error) {
      throw new Error('Failed to fetch asset manager id', { cause: error });
    }

    if (!object) {
      throw new Error('Asset manager id not found (no data)');
    }

    const fields = object.json;
    if (!fields) {
      throw new Error('Asset manager id not found (not a move object)');
    }

    if (!('latest_package_id' in fields)) {
      throw new Error('Asset manager id not found (no latest package id)');
    }

    const latestPackageId = fields['latest_package_id'];

    if (typeof latestPackageId !== 'string') {
      throw new Error('Asset manager id invalid (latest package id is not a string)');
    }

    if (!latestPackageId) {
      throw new Error('Asset manager id not found (no latest package id)');
    }

    return latestPackageId;
  }

  async waitForTransaction(params: SuiWaitForTransactionParams): Promise<SuiRawTransactionReceipt> {
    // `pollSchedule` holds absolute offsets and repeats its last interval, so `[0, n]` polls
    // immediately and then every `n` ms.
    const result = await this.client.core.waitForTransaction({
      digest: params.digest,
      include: { effects: true },
      timeout: params.timeoutMs,
      pollSchedule: [0, Math.max(1, params.pollingIntervalMs)],
    });

    const transaction = result.Transaction ?? result.FailedTransaction;
    return {
      digest: transaction.digest,
      effects: transaction.effects ? toSuiTransactionEffects(transaction.effects, transaction.epoch ?? '0') : undefined,
    };
  }
}
