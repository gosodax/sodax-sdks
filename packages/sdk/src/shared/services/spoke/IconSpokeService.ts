import * as IconSdkRaw from 'icon-sdk-js';
const IconSdk = ('default' in IconSdkRaw.default ? IconSdkRaw.default : IconSdkRaw) as typeof IconSdkRaw;
const { Converter, CallTransactionBuilder, CallBuilder } = IconSdk;
import type { IconService } from 'icon-sdk-js';
import * as rlp from 'rlp';
import type {
  SendMessageParams,
  DepositParams,
  EstimateGasParams,
  GetDepositParams,
  GetBalanceParams,
  GetBalancesParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import { createBalanceCollector, type WalletBalanceMap } from './balance-utils.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { sleep, BigIntToHex, encodeAddress, hexToBigInt } from '../../utils/shared-utils.js';
import {
  type IconChainKey,
  type IconTransactionResult,
  type Result,
  getIntentRelayChainId,
  isNativeToken,
  ChainKeys,
  type Hex,
  type IconGasEstimate,
  type TxReturnType,
} from '@sodax/types';
import { estimateStepCost } from '../../utils/icon-utils.js';

export class IconSpokeService {
  private readonly config: ConfigService;
  public readonly iconService: IconService;
  public readonly debugRpcUrl: string;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  constructor(config: ConfigService) {
    this.config = config;
    // since we only support mainnet for now, we can hardcode the single icon chain config
    const chainConfig = config.getChainConfig(ChainKeys.ICON_MAINNET);
    this.iconService = new IconSdk.IconService(new IconSdk.IconService.HttpProvider(chainConfig.rpcUrl));
    this.debugRpcUrl = chainConfig.debugRpcUrl;
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  public async estimateGas({ tx }: EstimateGasParams<IconChainKey>): Promise<IconGasEstimate> {
    return estimateStepCost(tx, this.debugRpcUrl);
  }

  /**
   * Deposit tokens to the spoke chain.
   * @param {DepositParams<IconChainKey, R>} params - The parameters for the deposit
   * @param {IconSpokeProviderType} spokeProvider - The provider for the spoke chain
   * @param {EvmHubProvider} hubProvider - The provider for the hub chain
   * @param {boolean} raw - The return type raw or just transaction hash
   * @returns {Promise<Result<string>>} A promise that resolves to the transaction hash
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<IconChainKey, R>,
  ): Promise<TxReturnType<IconChainKey, R>> {
    const { srcAddress: from, srcChainKey, to: recipient, token, amount, data } = params;
    const chainConfig = this.config.getChainConfig(srcChainKey);

    const rlpInput: rlp.Input = [data, recipient];
    const rlpEncodedData = rlp.encode(rlpInput);
    const hexData = `0x${Buffer.from(rlpEncodedData).toString('hex')}`;
    const txParams = {
      _to: chainConfig.addresses.assetManager,
      _value: BigIntToHex(amount),
      _data: hexData,
    };

    const isNative = isNativeToken(srcChainKey, token);
    const value: Hex = isNative ? BigIntToHex(amount) : '0x0';
    const to = isNative ? chainConfig.addresses.wICX : token;

    const rawTransaction = Converter.toRawTransaction(
      new CallTransactionBuilder()
        .from(from)
        .to(to)
        .stepLimit(Converter.toBigNumber('2000000'))
        .nid(chainConfig.nid)
        .version('0x3')
        .timestamp(new Date().getTime() * 1000)
        .value(value)
        .method('transfer')
        .params(txParams)
        .build(),
    );

    if (params.raw === true) {
      return rawTransaction satisfies TxReturnType<IconChainKey, true> as TxReturnType<IconChainKey, R>;
    }

    return params.walletProvider.sendTransaction({
      from: from,
      to: to,
      value: value,
      nid: chainConfig.nid,
      method: 'transfer',
      params: txParams,
    }) satisfies Promise<TxReturnType<IconChainKey, false>> as Promise<TxReturnType<IconChainKey, R>>;
  }

  /**
   * Get the balance of the token in the spoke chain asset manager.
   * @param {string} token - The address of the token to get the balance of
   * @param {IconSpokeProviderType} spokeProvider - The spoke provider
   * @returns {Promise<bigint>} The balance of the token
   */
  public async getDeposit(params: GetDepositParams<IconChainKey>): Promise<bigint> {
    const { token, srcChainKey } = params;
    const transaction = new CallBuilder()
      .to(token)
      .method('balanceOf')
      .params({ _owner: this.config.getChainConfig(srcChainKey).addresses.assetManager })
      .build();
    return this.readIrc2Balance(transaction);
  }

  /**
   * Read an int-returning SCORE call. `iconService.call(...)` registers no result converter, so
   * `execute()` resolves the raw JSON-RPC `result` — a bare hex string for an int, not `{ value }`.
   */
  private async readIrc2Balance(transaction: Parameters<IconService['call']>[0]): Promise<bigint> {
    const result = (await this.iconService.call(transaction).execute()) as unknown;
    if (typeof result !== 'string') {
      throw new Error(`[IconSpokeService] Unexpected balanceOf response: ${JSON.stringify(result)}`);
    }
    return hexToBigInt(result);
  }

  /**
   * Get the user's own wallet balance of a token on ICON, in smallest units. Native ICX is read
   * via `iconService.getBalance`; IRC-2 tokens via a `balanceOf(_owner)` call on the token contract.
   * @param {GetBalanceParams<IconChainKey>} params - The chain key, user address, and token.
   * @returns {Promise<bigint>} The token balance in smallest units.
   */
  public async getWalletBalance(params: GetBalanceParams<IconChainKey>): Promise<bigint> {
    const { srcChainKey, srcAddress, token } = params;

    if (isNativeToken(srcChainKey, token)) {
      const balance = await this.iconService.getBalance(srcAddress).execute();
      return BigInt(balance.toFixed());
    }

    const transaction = new CallBuilder().to(token.address).method('balanceOf').params({ _owner: srcAddress }).build();
    return this.readIrc2Balance(transaction);
  }

  /**
   * Get the user's own wallet balances of multiple tokens on ICON, in smallest units. Native ICX
   * is read via `iconService.getBalance`; IRC-2 balances are batched into a single `tryAggregate`
   * multicall so every `balanceOf(_owner)` read shares one round-trip.
   * @param {GetBalancesParams<IconChainKey>} params - The chain key, user address, and tokens.
   * @returns {Promise<WalletBalanceMap>} A map of token address to balance in smallest units.
   */
  public async getWalletBalances(params: GetBalancesParams<IconChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;

    const nativeTokens = tokens.filter(token => isNativeToken(srcChainKey, token));
    const nonNativeTokens = tokens.filter(token => !isNativeToken(srcChainKey, token));

    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    if (nativeTokens.length > 0) {
      // Every native entry resolves from the same read, so ask once and share the outcome.
      try {
        const balance = await this.iconService.getBalance(srcAddress).execute();
        for (const token of nativeTokens) {
          collector.ok(token.address, BigInt(balance.toFixed()));
        }
      } catch (error) {
        for (const token of nativeTokens) {
          collector.fail(token.address, error);
        }
      }
    }

    if (nonNativeTokens.length === 0) {
      return collector.finish();
    }

    // ICON multicall (`tryAggregate`) contract on mainnet, mirroring the wallet-sdk-react
    // IconXService balance reader — batches every IRC-2 `balanceOf` into a single round-trip.
    // requireSuccess=0x0 keeps one failing read from reverting the batch; it is reported as a
    // failed entry for that token rather than a zero balance.
    const multicallAddress = 'cxa4aa9185e23558cff990f494c1fd2845f6cbf741';
    const calls = nonNativeTokens.map(token => ({
      target: token.address,
      method: 'balanceOf',
      params: [srcAddress],
    }));
    const transaction = new CallBuilder()
      .to(multicallAddress)
      .method('tryAggregate')
      .params({ requireSuccess: Converter.toHex(0), calls })
      .build();
    const result = (await this.iconService.call(transaction).execute()) as { returnData?: unknown };
    const aggregated = result.returnData;
    if (!Array.isArray(aggregated) || aggregated.length !== nonNativeTokens.length) {
      // A short or absent list would silently zero the missing tail; the whole batch is unusable.
      throw new Error(
        `[IconSpokeService] tryAggregate returned ${Array.isArray(aggregated) ? aggregated.length : 'no'} entries for ${nonNativeTokens.length} tokens`,
      );
    }

    nonNativeTokens.forEach((token, index) => {
      const agg = aggregated[index] as { success?: string; returnData?: string } | undefined;
      if (agg && agg.success !== '0x0' && typeof agg.returnData === 'string') {
        collector.ok(token.address, hexToBigInt(agg.returnData));
      } else {
        collector.fail(token.address, new Error(`balanceOf failed for ${token.address}: ${agg?.returnData}`));
      }
    });

    return collector.finish();
  }

  /**
   * Sends a message to the hub chain.
   * @param {SendMessageParams} params - Includes dstChainKey, the chain key of the destination chain.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<IconChainKey, Raw>,
  ): Promise<TxReturnType<IconChainKey, Raw>> {
    const { srcAddress: from, srcChainKey, dstChainKey, dstAddress, payload } = params;
    const relayId = getIntentRelayChainId(dstChainKey);
    const chainConfig = this.config.getChainConfig(srcChainKey);

    const txParams = {
      dstChainId: relayId,
      dstAddress: dstAddress,
      payload: payload,
    };

    const transaction = new CallTransactionBuilder()
      .from(from)
      .to(chainConfig.addresses.connection)
      .stepLimit(Converter.toBigNumber('2000000'))
      .nid(chainConfig.nid)
      .version('0x3')
      .timestamp(new Date().getTime() * 1000)
      .method('sendMessage')
      .params(txParams)
      .build();

    if (params.raw === true) {
      return Converter.toRawTransaction(transaction) satisfies TxReturnType<IconChainKey, true> as TxReturnType<
        IconChainKey,
        Raw
      >;
    }

    return params.walletProvider.sendTransaction({
      from: from,
      to: chainConfig.addresses.connection,
      nid: chainConfig.nid,
      value: '0x0',
      method: 'sendMessage',
      params: txParams,
    }) satisfies Promise<TxReturnType<IconChainKey, false>> as Promise<TxReturnType<IconChainKey, Raw>>;
  }

  public encodeSimulationParams(token: string, assetManager: string): { encodedToken: Hex; encodedSrcAddress: Hex } {
    // Native ICX must be substituted with wICX — the wrapped form registered in the hub's asset manager.
    // The deposit() method performs the same substitution when sending the real transaction.
    const resolvedToken = isNativeToken(ChainKeys.ICON_MAINNET, token)
      ? this.config.getChainConfig(ChainKeys.ICON_MAINNET).addresses.wICX
      : token;
    return {
      encodedToken: encodeAddress(ChainKeys.ICON_MAINNET, resolvedToken),
      encodedSrcAddress: encodeAddress(ChainKeys.ICON_MAINNET, assetManager),
    };
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<IconChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<IconChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;
    const deadline = Date.now() + maxTimeoutMs;

    while (Date.now() < deadline) {
      try {
        const result = await this.iconService.getTransactionResult(txHash).execute();
        if (result.status === 1) {
          return { ok: true, value: { status: 'success', receipt: result as unknown as IconTransactionResult } };
        }
        return {
          ok: true,
          value: { status: 'failure', error: new Error(`Transaction failed: ${JSON.stringify(result)}`) },
        };
      } catch {
        // Transaction pending or not found — retry after delay
        await sleep(pollingIntervalMs);
      }
    }

    return {
      ok: true,
      value: {
        status: 'timeout',
        error: new Error(`Timed out after ${maxTimeoutMs}ms waiting for ICON transaction ${txHash}`),
      },
    };
  }
}
