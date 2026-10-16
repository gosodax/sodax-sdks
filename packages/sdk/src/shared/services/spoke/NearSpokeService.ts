import { fromHex } from 'viem';

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
import type { RateLimitConfig } from '../../types/types.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { sleep } from '../../utils/shared-utils.js';
import {
  getIntentRelayChainId,
  ChainKeys,
  type FillData,
  type FillIntent,
  type NearRawTransaction,
  type NearChainKey,
  type NearRawTransactionReceipt,
  type INearWalletProvider,
  type Result,
  type TxReturnType,
  isNativeToken,
} from '@sodax/types';
import { JsonRpcProvider } from 'near-api-js';

export type QueryResponse = string | number | boolean | object | undefined;
export type CallResponse = string | number | object | bigint | boolean;

export const NEAR_DEFAULT_GAS = BigInt('300000000000000'); // 30 TGas derived from near documentation as max limit
/** NEP-141 default storage bond for a one-time `storage_deposit` registration (0.00125 NEAR). */
export const NEAR_STORAGE_DEPOSIT = BigInt('1250000000000000000000'); // 0.00125 NEAR

export class NearSpokeService {
  private readonly config: ConfigService;
  public readonly rpcProvider: JsonRpcProvider;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  public constructor(config: ConfigService) {
    this.config = config;
    // since we only support mainnet for now, we can hardcode the single near chain config
    const chainConfig = config.getChainConfig(ChainKeys.NEAR_MAINNET);
    this.rpcProvider = new JsonRpcProvider({ url: chainConfig.rpcUrl });
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  public async estimateGas(_: EstimateGasParams<NearChainKey>): Promise<bigint> {
    return NEAR_DEFAULT_GAS;
  }

  queryContract(contractId: string, method: string, args: {}): Promise<QueryResponse> {
    return this.rpcProvider.callFunction({ contractId, method, args });
  }

  public async getRateLimit(token: string, srcChainKey: NearChainKey): Promise<RateLimitConfig> {
    const res = (await this.queryContract(
      this.config.getChainConfig(srcChainKey).addresses.rateLimit,
      'get_rate_limit',
      {
        token: token,
      },
    )) as { max_available: number; available: number; rate_per_second: number } | undefined;
    if (res == null || res === undefined) {
      return {
        maxAvailable: 0,
        available: 0,
        ratePerSecond: 0,
      };
    }
    return {
      maxAvailable: res.max_available,
      available: res.available,
      ratePerSecond: res.rate_per_second,
    } as RateLimitConfig;
  }

  private toFillIntent(fillData: FillData): FillIntent {
    return {
      amount: fillData.amount.toString(),
      fill_id: fillData.fill_id.toString(),
      intent_hash: Array.from(fromHex(fillData.intent_hash, 'bytes')),
      receiver: Array.from(Buffer.from(fillData.receiver, 'utf-8')),
      solver: Array.from(fromHex(fillData.solver, 'bytes')),
      token: Array.from(Buffer.from(fillData.token, 'utf-8')),
    } as FillIntent;
  }

  async fillIntent(
    fromInfo: {
      srcAddress: string;
      srcChainKey: NearChainKey;
    },
    fillData: FillData,
    // NEP-141 requires exactly 1 yoctoNEAR attached to ft_transfer_call; the native-token branch below overrides this with the amount.
    deposit: bigint = BigInt('1'),
    gas: bigint = BigInt('300000000000000'),
  ): Promise<NearRawTransaction> {
    const intentFiller = this.config.getChainConfig(fromInfo.srcChainKey).addresses.intentFiller;
    if (isNativeToken(fromInfo.srcChainKey, fillData.token)) {
      deposit = BigInt(fillData.amount);
      return {
        signerId: fromInfo.srcAddress,
        params: {
          contractId: intentFiller,
          method: 'fill_intent',
          args: { fill: this.toFillIntent(fillData) },
          deposit: deposit,
          gas: gas,
        },
      };
    }
    return {
      signerId: fromInfo.srcAddress,
      params: {
        contractId: fillData.token,
        method: 'ft_transfer_call',
        args: {
          receiver_id: intentFiller,
          amount: fillData.amount.toString(),
          memo: '',
          msg: JSON.stringify(this.toFillIntent(fillData)),
        },
        deposit: deposit,
        gas: gas,
      },
    };
  }

  /**
   * Deposit tokens to the spoke chain.
   * @param {CWSpokeDepositParams} params - The parameters for the deposit, including the user's address, token address, amount, and additional data.
   * @param {CWSpokeProvider} spokeProvider - The provider for the spoke chain.
   * @param {EvmHubProvider} hubProvider - The provider for the hub chain.
   * @param {boolean} raw - The return type raw or just transaction hash
   * @returns {PromiseNearTxReturnType<R>} A promise that resolves to the transaction hash.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<NearChainKey, R>,
  ): Promise<TxReturnType<NearChainKey, R>> {
    const inputParams = {
      token: params.token,
      to: Array.from(fromHex(params.to, 'bytes')),
      amount: params.amount.toString(),
      data: Array.from(fromHex(params.data, 'bytes')),
    };

    const assetManager = this.config.getChainConfig(params.srcChainKey).addresses.assetManager;
    let tx: NearRawTransaction;
    if (isNativeToken(params.srcChainKey, params.token)) {
      tx = {
        signerId: params.srcAddress,
        params: {
          contractId: assetManager,
          method: 'transfer',
          args: { to: inputParams.to, amount: inputParams.amount, data: inputParams.data },
          deposit: BigInt(inputParams.amount),
          gas: NEAR_DEFAULT_GAS,
        },
      };
    } else {
      tx = {
        signerId: params.srcAddress,
        params: {
          contractId: inputParams.token,
          method: 'ft_transfer_call',
          args: {
            receiver_id: assetManager,
            amount: inputParams.amount.toString(),
            memo: '',
            msg: JSON.stringify({
              to: inputParams.to,
              data: inputParams.data,
            }),
          },
          // NEP-141 requires exactly 1 yoctoNEAR attached to ft_transfer_call.
          deposit: BigInt('1'),
          gas: NEAR_DEFAULT_GAS,
        },
      };
    }

    if (params.raw === true) {
      return tx satisfies TxReturnType<NearChainKey, true> as TxReturnType<NearChainKey, R>;
    }
    return params.walletProvider.signAndSubmitTxn(tx) satisfies Promise<TxReturnType<NearChainKey, false>> as Promise<
      TxReturnType<NearChainKey, R>
    >;
  }

  /**
   * Get the balance of the token in the spoke chain.
   * @param {Address} token - The address of the token to get the balance of.
   * @param {CWSpokeProvider} spokeProvider - The spoke provider.
   * @returns {Promise<bigint>} The balance of the token.
   */
  public async getDeposit(params: GetDepositParams<NearChainKey>): Promise<bigint> {
    const assetManager = this.config.getChainConfig(params.srcChainKey).addresses.assetManager;
    let bal: unknown;
    if (isNativeToken(params.srcChainKey, params.token)) {
      bal = await this.queryContract(assetManager, 'get_balance', {});
    } else {
      bal = await this.queryContract(params.token, 'ft_balance_of', {
        account_id: assetManager,
      });
    }

    if (typeof bal !== 'string') {
      throw new Error('[NearSpokeService.getDeposit] Failed to get balance. Unexpected response type.');
    }

    return BigInt(bal);
  }

  /**
   * Get the user's own wallet balance of a token on NEAR, in smallest units (yoctoNEAR for the
   * native coin). Native NEAR via the account's `viewAccount().amount`; NEP-141 tokens via the
   * token contract's `ft_balance_of` view. Reads the balance held by `srcAddress` (the user
   * wallet), not the protocol asset manager. Uses this service's own configured RPC provider.
   * @param {GetBalanceParams<NearChainKey>} params - The chain key, user address, and token.
   * @returns {Promise<bigint>} The token balance in smallest units.
   */
  public async getWalletBalance(params: GetBalanceParams<NearChainKey>): Promise<bigint> {
    if (isNativeToken(params.srcChainKey, params.token)) {
      const account = await this.rpcProvider.viewAccount({ accountId: params.srcAddress });
      return BigInt(account.amount);
    }

    const bal = await this.queryContract(params.token.address, 'ft_balance_of', {
      account_id: params.srcAddress,
    });

    if (typeof bal !== 'string') {
      throw new Error('[NearSpokeService.getWalletBalance] Failed to get balance. Unexpected response type.');
    }

    return BigInt(bal);
  }

  /**
   * Get the user's own wallet balances of multiple tokens on NEAR, in smallest units. Fans out
   * over {@link getWalletBalance}, keyed by `token.address`.
   * @param {GetBalancesParams<NearChainKey>} params - The chain key, user address, and tokens.
   * @returns {Promise<WalletBalanceMap>} A map of token address to balance in smallest units.
   */
  public async getWalletBalances(params: GetBalancesParams<NearChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token =>
      this.getWalletBalance({ srcChainKey, srcAddress, token }),
    );
    return collector.finish();
  }

  /**
   * Whether `accountId` is storage-registered on a NEP-141 `token` contract. NEP-141 requires an
   * account to pay a one-time storage bond before it can receive (hold a balance of) the token, so
   * this gates any leg that delivers a token to a user on NEAR (swap output on NEAR, bridge into
   * NEAR, money-market borrow/withdraw to NEAR).
   *
   * Native NEAR is not a NEP-141 token and has no storage registration, so this returns `true` for
   * the native token. The view goes through {@link queryContract}, i.e. the configurable RPC from
   * chain config — a custom `rpcUrl` passed to the SDK is honoured.
   */
  public async isStorageRegistered(token: string, accountId: string): Promise<boolean> {
    if (isNativeToken(ChainKeys.NEAR_MAINNET, token)) {
      return true;
    }
    const balance = await this.queryContract(token, 'storage_balance_of', { account_id: accountId });
    return balance != null;
  }

  /**
   * Build (and, unless `raw`, submit) a NEP-141 `storage_deposit` registration for `accountId` on
   * the `token` contract. Call this when {@link isStorageRegistered} is `false` before a token is
   * delivered to the account on NEAR.
   *
   * Native NEAR has no storage registration — passing the native token throws.
   *
   * @param params.deposit Storage bond to attach; defaults to {@link NEAR_STORAGE_DEPOSIT}
   *   (0.00125 NEAR). Override per token if its `storage_balance_bounds.min` differs.
   */
  public async registerStorage<Raw extends boolean = false>(params: {
    token: string;
    accountId: string;
    walletProvider: INearWalletProvider;
    deposit?: bigint;
    raw?: Raw;
  }): Promise<TxReturnType<NearChainKey, Raw>> {
    if (isNativeToken(ChainKeys.NEAR_MAINNET, params.token)) {
      throw new Error('[NearSpokeService.registerStorage] Native NEAR has no NEP-141 storage registration.');
    }

    const tx: NearRawTransaction = {
      signerId: params.accountId,
      params: {
        contractId: params.token,
        method: 'storage_deposit',
        args: { account_id: params.accountId, registration_only: true },
        deposit: params.deposit ?? NEAR_STORAGE_DEPOSIT,
        gas: NEAR_DEFAULT_GAS,
      },
    } satisfies NearRawTransaction;

    if (params.raw === true) {
      return tx satisfies TxReturnType<NearChainKey, true> as TxReturnType<NearChainKey, Raw>;
    }

    return params.walletProvider.signAndSubmitTxn(tx) satisfies Promise<TxReturnType<NearChainKey, false>> as Promise<
      TxReturnType<NearChainKey, Raw>
    >;
  }

  /**
   * Sends a message to the hub chain.
   * @param {SendMessageParams} params - Includes dstChainKey, the chain key of the hub chain.
   * @param {Address} dstAddress - The address on the hub chain.
   * @param {Hex} payload - The payload to send.
   * @param {CWSpokeProvider} spokeProvider - The provider for the spoke chain.
   * @returns {Promise<TxReturnType<S, R>>} A promise that resolves to the transaction hash.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<NearChainKey, Raw>,
  ): Promise<TxReturnType<NearChainKey, Raw>> {
    const dstRelayChainId = getIntentRelayChainId(params.dstChainKey);

    const tx: NearRawTransaction = {
      signerId: params.srcAddress,
      params: {
        contractId: this.config.getChainConfig(params.srcChainKey).addresses.connection,
        method: 'send_message',
        args: {
          dst_address: Array.from(fromHex(params.dstAddress, 'bytes')),
          dst_chain_id: Number.parseInt(dstRelayChainId.toString()),
          payload: Array.from(fromHex(params.payload, 'bytes')),
        },
        deposit: BigInt('0'),
        gas: NEAR_DEFAULT_GAS, // TODO: estimate gas properly?
      },
    } satisfies NearRawTransaction;

    if (params.raw === true) {
      return tx satisfies TxReturnType<NearChainKey, true> as TxReturnType<NearChainKey, Raw>;
    }

    return params.walletProvider.signAndSubmitTxn(tx) satisfies Promise<TxReturnType<NearChainKey, false>> as Promise<
      TxReturnType<NearChainKey, Raw>
    >;
  }

  /**
   * Get Max Withdrawable Balance for the token.
   * @param {Address} token - The address of the token to get the balance of.
   * @param {NearSpokeProvider} spokeProvider - The spoke provider.
   * @returns {Promise<bigint>} The max limit of the token.
   */
  public async getLimit(token: string, srcChainKey: NearChainKey): Promise<bigint> {
    const rate_limit = await this.getRateLimit(token, srcChainKey);
    return BigInt(rate_limit.maxAvailable);
  }

  /**
   * Get available withdrawable amount for the token.
   * @param {Address} token - The address of the token to get the balance of.
   * @param {NearSpokeProvider} spokeProvider - The spoke provider.
   * @returns {Promise<bigint>} The available withdrawable amount of the token.
   */
  public async getAvailable(token: string, srcChainKey: NearChainKey): Promise<bigint> {
    const rate_limit = await this.getRateLimit(token, srcChainKey);
    return BigInt(rate_limit.available);
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<NearChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<NearChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;
    const accountId = this.config.getChainConfig(params.chainKey).addresses.assetManager;
    const maxRetries = Math.round(maxTimeoutMs / pollingIntervalMs);

    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        const outcome = await this.rpcProvider.viewTransactionStatus({ txHash, accountId, waitUntil: 'FINAL' });

        const status = outcome?.status as Record<string, unknown> | undefined;
        if (status && ('SuccessValue' in status || 'SuccessReceiptId' in status)) {
          return { ok: true, value: { status: 'success', receipt: outcome satisfies NearRawTransactionReceipt } };
        }
        if (status && 'Failure' in status) {
          return {
            ok: true,
            value: { status: 'failure', error: new Error(`Transaction failed: ${JSON.stringify(status.Failure)}`) },
          };
        }

        if (retry < maxRetries) {
          await sleep(pollingIntervalMs);
        }
      } catch {
        if (retry < maxRetries) {
          await sleep(pollingIntervalMs);
        }
      }
    }

    return {
      ok: true,
      value: {
        status: 'timeout',
        error: new Error(`NEAR transaction ${txHash} was not confirmed after ${maxRetries} retries`),
      },
    };
  }
}
