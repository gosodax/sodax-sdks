import { bcs } from '@mysten/sui/bcs';
import { fromHex, toHex } from 'viem';
import { Transaction, type TransactionResult, type TransactionArgument } from '@mysten/sui/transactions';
import {
  getIntentRelayChainId,
  type Hex,
  type Result,
  type SuiPaginatedCoins,
  type SuiExecutionResult,
  type SuiRawTransactionReceipt,
  type SuiChainKey,
  ChainKeys,
  isNativeToken,
  type TxReturnType,
  type SuiGasEstimate,
  type SuiTransport,
} from '@sodax/types';
import type {
  DepositParams,
  EstimateGasParams,
  GetDepositParams,
  GetBalanceParams,
  GetBalancesParams,
  SendMessageParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { isTimeoutError } from '../../utils/sui-utils.js';
import { SuiGrpcTransport } from './SuiGrpcTransport.js';

type SuiNativeCoinResult = { $kind: 'NestedResult'; NestedResult: [number, number] };
type SuiTxObject = { $kind: 'Input'; Input: number; type?: 'object' | undefined };
type AssetManagerTarget = { packageId: string; moduleId: string; stateId: string };

export class SuiSpokeService {
  private readonly config: ConfigService;
  public readonly transport: SuiTransport;
  /** @deprecated Renamed to `transport`, and no longer a raw `@mysten/sui` client. */
  public readonly publicClient: SuiTransport;
  /** In-flight `latest_package_id` reads, dropped once settled: concurrent callers share one, later builds re-read. */
  private readonly assetManagerLookups = new Map<SuiChainKey, Promise<AssetManagerTarget>>();
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  public constructor(config: ConfigService) {
    this.config = config;
    // Only mainnet is supported, so the single Sui chain config is used.
    const chainConfig = config.getChainConfig(ChainKeys.SUI_MAINNET);
    // Packaged config never sets `rpc_url`, so its presence is a consumer override under the old name; honor it.
    this.transport = new SuiGrpcTransport(chainConfig.rpc_url ?? chainConfig.grpc_url);
    this.publicClient = this.transport;
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  async getCoins(address: string, token: string): Promise<SuiPaginatedCoins> {
    return this.transport.getCoins(address, token);
  }

  public async getCoin(
    tx: Transaction,
    coin: string,
    amount: bigint,
    address: string,
  ): Promise<TransactionResult | SuiTxObject> {
    const coins = await this.getCoins(address, coin);

    const objects: string[] = [];
    let totalAmount = BigInt(0);

    for (const coin of coins.data) {
      totalAmount += BigInt(coin.balance);
      objects.push(coin.coinObjectId);

      if (totalAmount >= amount) {
        break;
      }
    }

    const firstObject = objects[0];

    if (!firstObject) {
      throw new Error(`[SuiIntentService.getCoin] Coin=${coin} not found for address=${address} and amount=${amount}`);
    }

    if (objects.length > 1) {
      tx.mergeCoins(firstObject, objects.slice(1));
    }

    if (totalAmount === amount) {
      return tx.object(firstObject);
    }

    return tx.splitCoins(firstObject, [amount]);
  }

  splitAddress(address: string): { packageId: string; moduleId: string; stateId: string } {
    const parts = address.split('::');
    if (parts.length === 3) {
      if (parts[0] && parts[1] && parts[2]) {
        return { packageId: parts[0], moduleId: parts[1], stateId: parts[2] };
      }
      throw new Error('Invalid package address');
    }
    throw new Error('Invalid package address');
  }

  public async getNativeCoin(tx: Transaction, amount: bigint): Promise<SuiNativeCoinResult> {
    const coin = tx.splitCoins(tx.gas, [tx.pure.u64(amount)])[0];

    if (coin === undefined) {
      return Promise.reject(Error('[SuiIntentService.getNativeCoin] coin undefined'));
    }

    return coin;
  }

  public encodeSimulationParams(token: string, assetManager: string): { encodedToken: Hex; encodedSrcAddress: Hex } {
    // Sui tokens and the asset manager are Move type strings ("0xPKG::module::STATE"), which BCS Address cannot
    // serialize; the hub expects them UTF-8 encoded, as the Sui contract sends on-chain.
    const encoder = new TextEncoder();
    return {
      encodedToken: toHex(encoder.encode(token)),
      encodedSrcAddress: toHex(encoder.encode(assetManager)),
    };
  }

  async getAssetManagerAddress(chainId: SuiChainKey): Promise<string> {
    const { packageId, moduleId, stateId } = await this.resolveAssetManager(chainId);
    return `${packageId}::${moduleId}::${stateId}`;
  }

  /** An upgraded Sui package moves address and the old one aborts on `enforce_version`, so the id is read per call. */
  private async resolveAssetManager(chainId: SuiChainKey): Promise<AssetManagerTarget> {
    const inFlight = this.assetManagerLookups.get(chainId);
    if (inFlight) return inFlight;

    const lookup = this.fetchAssetManagerAddress(chainId)
      .then(address => this.splitAddress(address))
      .finally(() => this.assetManagerLookups.delete(chainId));

    this.assetManagerLookups.set(chainId, lookup);
    return lookup;
  }

  public async viewContract(
    tx: Transaction,
    packageId: string,
    module: string,
    functionName: string,
    args: unknown[],
    typeArgs: string[] = [],
    sender: string,
  ): Promise<SuiExecutionResult> {
    tx.moveCall({
      target: `${packageId}::${module}::${functionName}`,
      arguments: args as TransactionArgument[],
      typeArguments: typeArgs,
    });

    return this.transport.simulate(tx, sender);
  }

  async deposit<R extends boolean = false>(
    params: DepositParams<SuiChainKey, R>,
  ): Promise<TxReturnType<SuiChainKey, R>> {
    const { tx, assetManager } = await this.buildDepositTransaction(params);

    if (params.raw === true) {
      // Unbuilt PTB as Transaction JSON (round-trips via Transaction.from()); the wallet sets sender and gas at build time.
      return {
        from: params.srcAddress,
        to: `${assetManager.packageId}::${assetManager.moduleId}::transfer`,
        value: params.amount,
        data: tx.serialize(),
      } satisfies TxReturnType<SuiChainKey, true> as TxReturnType<SuiChainKey, R>;
    }

    return params.walletProvider.signAndExecuteTxn(tx) satisfies Promise<TxReturnType<SuiChainKey, false>> as Promise<
      TxReturnType<SuiChainKey, R>
    >;
  }

  private async buildDepositTransaction<R extends boolean>(
    params: DepositParams<SuiChainKey, R>,
  ): Promise<{ tx: Transaction; assetManager: AssetManagerTarget }> {
    const { srcAddress: from, srcChainKey, token, to, amount, data = '0x' } = params;
    const isNative = isNativeToken(srcChainKey, token);
    const tx = new Transaction();
    const connection = this.splitAddress(this.config.getChainConfig(srcChainKey).addresses.connection);
    // Independent reads, and only the coin lookup writes commands to `tx`, so running them together keeps command order.
    const [coin, assetManager]: [TransactionResult | SuiNativeCoinResult | SuiTxObject, AssetManagerTarget] =
      await Promise.all([
        isNative ? this.getNativeCoin(tx, amount) : this.getCoin(tx, token, amount, from),
        this.resolveAssetManager(srcChainKey),
      ]);

    tx.moveCall({
      target: `${assetManager.packageId}::${assetManager.moduleId}::transfer`,
      typeArguments: [token],
      arguments: [
        tx.object(assetManager.stateId),
        tx.object(connection.stateId), // Connection state object
        coin,
        tx.pure(bcs.vector(bcs.u8()).serialize(fromHex(to, 'bytes'))),
        tx.pure(bcs.vector(bcs.u8()).serialize(fromHex(data, 'bytes'))),
      ],
    });

    return { tx, assetManager };
  }

  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<SuiChainKey, Raw>,
  ): Promise<TxReturnType<SuiChainKey, Raw>> {
    const { srcAddress: from, srcChainKey, dstChainKey, dstAddress, payload } = params;

    const txb = new Transaction();
    const connection = this.splitAddress(this.config.getChainConfig(srcChainKey).addresses.connection);

    const relayId = getIntentRelayChainId(dstChainKey);
    txb.moveCall({
      target: `${connection.packageId}::${connection.moduleId}::send_message_ua`,
      arguments: [
        txb.object(connection.stateId),
        txb.pure.u256(relayId),
        txb.pure(bcs.vector(bcs.u8()).serialize(fromHex(dstAddress, 'bytes'))),
        txb.pure(bcs.vector(bcs.u8()).serialize(fromHex(payload, 'bytes'))),
      ],
    });

    if (params.raw === true) {
      // Unbuilt PTB as Transaction JSON (round-trips via Transaction.from()); the wallet sets sender and gas at build time.
      return {
        from: from,
        to: `${connection.packageId}::${connection.moduleId}::send_message_ua`,
        value: 0n,
        data: txb.serialize(),
      } satisfies TxReturnType<SuiChainKey, true> as TxReturnType<SuiChainKey, Raw>;
    }

    return params.walletProvider.signAndExecuteTxn(txb) satisfies Promise<TxReturnType<SuiChainKey, false>> as Promise<
      TxReturnType<SuiChainKey, Raw>
    >;
  }

  /** Returns the estimated computation cost. */
  public async estimateGas({ tx }: EstimateGasParams<SuiChainKey>): Promise<SuiGasEstimate> {
    return this.transport.estimateGas(Transaction.from(tx.data), tx.from);
  }

  /** Balance of the token in the spoke chain asset manager. */
  public async getDeposit(params: GetDepositParams<SuiChainKey>): Promise<bigint> {
    const assetmanager = await this.resolveAssetManager(params.srcChainKey);
    const tx = new Transaction();
    const result = await this.viewContract(
      tx,
      assetmanager.packageId,
      assetmanager.moduleId,
      'get_token_balance',
      [tx.object(assetmanager.stateId)],
      [params.token],
      params.srcAddress,
    );
    if (
      !Array.isArray(result?.returnValues) ||
      !Array.isArray(result.returnValues[0]) ||
      result.returnValues[0][0] === undefined
    ) {
      throw new Error('Failed to get Balance');
    }
    const val: number[] = result.returnValues[0][0];
    const str_u64 = bcs.U64.parse(Uint8Array.from(val));
    return BigInt(str_u64);
  }

  /** Native SUI is read via `0x2::sui::SUI`; other coins by their coinType (`token.address`). */
  public async getWalletBalance(params: GetBalanceParams<SuiChainKey>): Promise<bigint> {
    const { srcChainKey, srcAddress, token } = params;

    let coinType = isNativeToken(srcChainKey, token) ? '0x2::sui::SUI' : token.address;

    // TODO: hardcoded remap for legacy bnUSD, whose on-chain coinType drops the leading zero in the package id.
    if (
      coinType ===
      '0x03917a812fe4a6d6bc779c5ab53f8a80ba741f8af04121193fc44e0f662e2ceb::balanced_dollar::BALANCED_DOLLAR'
    ) {
      coinType = '0x3917a812fe4a6d6bc779c5ab53f8a80ba741f8af04121193fc44e0f662e2ceb::balanced_dollar::BALANCED_DOLLAR';
    }

    // `getCoins` is paged (gRPC `listCoins` limit), so sum every coin object across all pages.
    let total = 0n;
    let cursor: string | null | undefined;
    do {
      const page = await this.transport.getCoins(srcAddress, coinType, undefined, cursor);
      for (const coin of page.data) {
        total += BigInt(coin.balance);
      }
      cursor = page.hasNextPage ? page.nextCursor : undefined;
    } while (cursor);

    return total;
  }

  public async getWalletBalances(params: GetBalancesParams<SuiChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  public async fetchAssetManagerAddress(chainId: SuiChainKey): Promise<string> {
    const latestPackageId = await this.fetchLatestAssetManagerPackageId(chainId);

    return `${latestPackageId}::asset_manager::${this.config.getChainConfig(chainId).addresses.assetManagerConfigId}`;
  }

  public async fetchLatestAssetManagerPackageId(chainId: SuiChainKey): Promise<string> {
    return this.transport.fetchLatestPackageId(this.config.getChainConfig(chainId).addresses.assetManagerConfigId);
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<SuiChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<SuiChainKey>>> {
    try {
      const result = await this.transport.waitForTransaction({
        digest: params.txHash,
        timeoutMs: params.maxTimeoutMs ?? this.maxTimeoutMs,
        pollingIntervalMs: params.pollingIntervalMs ?? this.pollingIntervalMs,
      });

      if (!result.effects?.status) {
        return {
          ok: true,
          value: {
            status: 'failure',
            error: new Error(`Transaction effects unavailable for digest=${params.txHash}`),
          },
        };
      }

      if (result.effects.status.status === 'failure') {
        return {
          ok: true,
          value: {
            status: 'failure',
            error: new Error(`Transaction failed: ${result.effects.status.error ?? 'unknown'}`),
          },
        };
      }

      return { ok: true, value: { status: 'success', receipt: result satisfies SuiRawTransactionReceipt } };
    } catch (error) {
      return {
        ok: true,
        value: {
          status: isTimeoutError(error) ? 'timeout' : 'failure',
          error: error instanceof Error ? error : new Error(String(error)),
        },
      };
    }
  }
}
