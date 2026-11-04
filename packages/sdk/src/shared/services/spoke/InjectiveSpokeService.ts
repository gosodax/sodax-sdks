import { fromHex } from 'viem';
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
import type { WalletBalanceMap } from './balance-utils.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { sleep } from '../../utils/shared-utils.js';
import {
  toBase64,
  ChainGrpcWasmApi,
  IndexerGrpcAccountPortfolioApi,
  TxGrpcApi,
  fromBase64,
  MsgExecuteContract,
  createTransaction,
  ChainRestAuthApi,
  BaseAccount,
} from '@injectivelabs/sdk-ts';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx.js';
import { Network, getNetworkEndpoints, type NetworkEndpoints } from '@injectivelabs/networks';
import {
  getIntentRelayChainId,
  isNativeToken,
  ChainKeys,
  type InjectiveChainKey,
  type InjectiveRawTransaction,
  type InjectiveCoin,
  type Result,
  type JsonObject,
  type InjectiveExecuteResponse,
  type IInjectiveWalletProvider,
  type Hex,
  type InjectiveGasEstimate,
  type TxReturnType,
} from '@sodax/types';

export interface InstantiateMsg {
  connection: string;
  rate_limit: string;
  hub_chain_id: string; // u128 as string
  hub_asset_manager: Uint8Array;
}

export interface ConnMsg {
  send_message?: {
    dst_chain_id: number;
    dst_address: Array<number>;
    payload: Array<number>;
  };
}

export interface ExecuteMsg {
  transfer?: {
    token: string;
    to: Array<number>;
    amount: string; // should be string for u128 , but in injective it fails in type conversion.
    data: Array<number>;
  };
  recv_message?: {
    src_chain_id: string; // u128 as string
    src_address: Uint8Array;
    conn_sn: string; // u128 as string
    payload: Uint8Array;
    signatures: Uint8Array[];
  };
  set_rate_limit?: {
    rate_limit: string;
  };
  set_connection?: {
    connection: string;
  };
  set_owner?: {
    owner: string;
  };
}

export interface QueryMsg {
  get_state: {};
}

export interface State {
  connection: string;
  rate_limit: string;
  hub_asset_manager: Uint8Array;
  hub_chain_id: string; // u128 as string
  owner: string;
}

/**
 * InjectiveSpokeService provides methods for interacting with the Injective spoke chain,
 * specifically for managing token deposits and transfers between the spoke chain and hub chain.
 * It handles the cross-chain communication and token bridging functionality, allowing users to:
 * - Deposit tokens from Injective to the hub chain
 * - Check token balances on the spoke chain
 * - Transfer tokens with custom data payloads
 */

/**
 * Safety multiplier applied to the simulated gas so the broadcast tx doesn't run out of gas.
 * Matches the default `gasBufferCoefficient` of `@injectivelabs`' `MsgBroadcaster(WithPk)`, which the
 * non-raw `execute()` path relies on.
 */
const GAS_BUFFER_MULTIPLIER = 1.2;

/** Splits a chain-config gas price like `"500000000inj"` into `<amount><denom>`. */
const GAS_PRICE_REGEX = /^(\d+)(.*)$/;

export class InjectiveSpokeService {
  private readonly config: ConfigService;
  public readonly chainGrpcWasmApi: ChainGrpcWasmApi;
  public readonly indexerGrpcAccountPortfolioApi: IndexerGrpcAccountPortfolioApi;
  public readonly txClient: TxGrpcApi;
  public readonly endpoints: NetworkEndpoints;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;
  private readonly gasPrice: string;

  public constructor(config: ConfigService) {
    this.config = config;
    this.endpoints = getNetworkEndpoints(Network.Mainnet);
    this.chainGrpcWasmApi = new ChainGrpcWasmApi(this.endpoints.grpc);
    this.indexerGrpcAccountPortfolioApi = new IndexerGrpcAccountPortfolioApi(this.endpoints.indexer);
    this.txClient = new TxGrpcApi(this.endpoints.grpc);
    this.pollingIntervalMs =
      this.config.sodaxConfig.chains[ChainKeys.INJECTIVE_MAINNET].pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = this.config.sodaxConfig.chains[ChainKeys.INJECTIVE_MAINNET].pollingConfig.maxTimeoutMs;
    this.gasPrice = this.config.getChainConfig(ChainKeys.INJECTIVE_MAINNET).gasPrice;
  }

  /** Parse a chain-config gas price like `"500000000inj"` into its numeric price and denom. */
  private parseGasPrice(gasPrice: string): { price: bigint; denom: string } {
    const match = GAS_PRICE_REGEX.exec(gasPrice);
    const price = match?.[1];
    if (price === undefined) {
      throw new Error(`Invalid Injective gasPrice config: ${gasPrice}`);
    }
    return { price: BigInt(price), denom: match?.[2] || 'inj' };
  }

  /**
   * Estimate the gas for a transaction.
   * @param {InjectiveRawTransaction} rawTx - The raw transaction to estimate the gas for.
   * @param {InjectiveSpokeProviderType} spokeProvider - The provider for the spoke chain.
   * @returns {Promise<InjectiveGasEstimate>} The estimated gas for the transaction.
   */
  public async estimateGas({ tx }: EstimateGasParams<InjectiveChainKey>): Promise<InjectiveGasEstimate> {
    const txRaw = TxRaw.fromPartial({
      bodyBytes: tx.signedDoc.bodyBytes,
      authInfoBytes: tx.signedDoc.authInfoBytes,
      signatures: [], // not required for simulation
    });

    const { gasInfo } = await this.txClient.simulate(txRaw);

    return {
      gasWanted: gasInfo.gasWanted,
      gasUsed: gasInfo.gasUsed,
    } satisfies InjectiveGasEstimate;
  }

  /**
   * Deposit tokens to the spoke chain.
   * @param {InjectiveSpokeDepositParams} params - The parameters for the deposit, including the user's address, token address, amount, and additional data.
   * @param {InjectiveSpokeProviderType} spokeProvider - The provider for the spoke chain.
   * @param {EvmHubProvider} hubProvider - The provider for the hub chain.
   * @param {boolean} raw - The return type raw or just transaction hash
   * @returns {Promise<TxReturnType<InjectiveSpokeProviderType, R>>} A promise that resolves to the transaction hash.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<InjectiveChainKey, R>,
  ): Promise<TxReturnType<InjectiveChainKey, R>> {
    const { srcChainKey, srcAddress: from, token, to, amount, data = '0x' } = params;

    const toBytes = fromHex(to, 'bytes');
    const dataBytes = fromHex(data, 'bytes');

    const msg: ExecuteMsg = {
      transfer: {
        token: token,
        to: Array.from(toBytes),
        amount: amount.toString(),
        data: Array.from(dataBytes),
      },
    };

    const funds = [{ amount: amount.toString(), denom: token }];

    const chainConfig = this.config.getChainConfig(srcChainKey);

    if (params.raw === true) {
      return (await this.getRawTransaction(
        chainConfig.networkId,
        from,
        chainConfig.addresses.assetManager,
        msg,
        undefined,
        funds,
      )) satisfies TxReturnType<InjectiveChainKey, true> as TxReturnType<InjectiveChainKey, R>;
    }

    const res = await params.walletProvider.execute(from, chainConfig.addresses.assetManager, msg, funds);
    return res.transactionHash satisfies TxReturnType<InjectiveChainKey, false> as TxReturnType<InjectiveChainKey, R>;
  }

  /**
   * Get the balance of the token that deposited in the spoke chain Asset Manager.
   * @param {Address} token - The address of the token to get the balance of.
   * @param {InjectiveSpokeProviderType} spokeProvider - The spoke provider.
   * @returns {Promise<bigint>} The balance of the token.
   */
  public async getDeposit(params: GetDepositParams<InjectiveChainKey>): Promise<bigint> {
    const response = await this.chainGrpcWasmApi.fetchSmartContractState(
      this.config.getChainConfig(params.srcChainKey).addresses.assetManager,
      toBase64({
        get_balance: { denom: params.token },
      }),
    );

    // TODO: check if this is correct
    return BigInt(fromBase64(response.data as unknown as string) as unknown as number);
  }

  /**
   * Get the user's own wallet balance of a token on Injective, in smallest units. On Injective every
   * asset is a bank coin, so the native coin (`inj`) and factory/peggy/IBC tokens are all read from the
   * account's portfolio bank balances and matched by denom. The denom is the chain's native denom for
   * the native coin and `params.token.address` for standard tokens.
   * @param {GetBalanceParams<InjectiveChainKey>} params - The chain key, user address, and token.
   * @returns {Promise<bigint>} The token balance in smallest units, or 0n when the account holds none.
   */
  public async getWalletBalance(params: GetBalanceParams<InjectiveChainKey>): Promise<bigint> {
    const denom = isNativeToken(params.srcChainKey, params.token)
      ? this.config.getChainConfig(params.srcChainKey).nativeToken
      : params.token.address;

    const portfolio = await this.indexerGrpcAccountPortfolioApi.fetchAccountPortfolioBalances(params.srcAddress);
    const balance = portfolio.bankBalancesList.find(_balance => _balance.denom === denom);

    return balance ? BigInt(balance.amount) : 0n;
  }

  /**
   * Get the user's own wallet balances of multiple tokens on Injective, in smallest units.
   * @param {GetBalancesParams<InjectiveChainKey>} params - The chain key, user address, and tokens.
   * @returns {Promise<WalletBalanceMap>} A map of token address to balance in smallest units.
   */
  public async getWalletBalances(params: GetBalancesParams<InjectiveChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    // One portfolio fetch returns every bank balance, so read once and match each token by denom
    // instead of fanning out a full portfolio request per token. A failure here is batch-wide —
    // there is no per-token read to isolate — so it propagates to the router.
    const portfolio = await this.indexerGrpcAccountPortfolioApi.fetchAccountPortfolioBalances(srcAddress);
    const amountByDenom = new Map(portfolio.bankBalancesList.map(balance => [balance.denom, BigInt(balance.amount)]));
    const nativeDenom = this.config.getChainConfig(srcChainKey).nativeToken;

    const balances: WalletBalanceMap = {};
    for (const token of tokens) {
      const denom = isNativeToken(srcChainKey, token) ? nativeDenom : token.address;
      // The bank module omits zero-balance denoms, so an absent denom is a confirmed zero.
      balances[token.address] = amountByDenom.get(denom) ?? 0n;
    }
    return balances;
  }

  public async getRawTransaction(
    chainId: string,
    senderAddress: string,
    contractAddress: string,
    msg: JsonObject,
    memo?: string,
    funds: InjectiveCoin[] = [],
  ): Promise<InjectiveRawTransaction> {
    const msgExec = MsgExecuteContract.fromJSON({
      contractAddress: contractAddress,
      sender: senderAddress,
      msg: msg as object,
      funds,
    });

    // Fetch the on-chain account once (number, sequence, pubKey) and reuse it for both the
    // simulation draft and the final tx — avoids the double account/block fetch that calling
    // `createTransactionForAddressAndMsg` twice would incur.
    const accountResponse = await new ChainRestAuthApi(this.endpoints.rest).fetchCosmosAccount(senderAddress);
    const baseAccount = BaseAccount.fromRestCosmosApi(accountResponse);
    const pubKey = baseAccount.pubKey.key;
    if (!pubKey) {
      throw new Error(`The pubKey for ${senderAddress} is missing — the account has not signed a transaction yet.`);
    }
    const txArgs = {
      message: msgExec,
      memo: memo || '',
      pubKey,
      sequence: baseAccount.sequence,
      accountNumber: baseAccount.accountNumber,
      chainId,
    };

    // 1. Build a draft (default fee) and simulate it to size the gas. `createTransaction` is pure
    //    (no network) — sequence + pubKey come from the account fetched above.
    const draft = createTransaction(txArgs);

    const { gasInfo } = await this.txClient.simulate(
      TxRaw.fromPartial({
        bodyBytes: draft.txRaw.bodyBytes,
        authInfoBytes: draft.txRaw.authInfoBytes,
        signatures: [], // not required for simulation
      }),
    );

    // 2. Build an explicit self-pay fee (no granter/payer) from the simulated gas + chain gasPrice.
    const gas = Math.ceil(gasInfo.gasUsed * GAS_BUFFER_MULTIPLIER);
    const { price, denom } = this.parseGasPrice(this.gasPrice);
    const fee = {
      amount: [{ denom, amount: (BigInt(gas) * price).toString() }],
      gas: gas.toString(),
    };

    // 3. Rebuild with the explicit fee. authInfoBytes now carries the fee, and signDoc carries the
    //    real account number (the old path discarded it, hardcoding 0 → signature verification failed).
    const { txRaw, signDoc } = createTransaction({ ...txArgs, fee });

    const rawTx = {
      from: senderAddress as Hex,
      to: contractAddress as Hex,
      signedDoc: {
        bodyBytes: txRaw.bodyBytes,
        chainId: chainId,
        accountNumber: BigInt(signDoc.accountNumber),
        authInfoBytes: txRaw.authInfoBytes,
      },
    };
    return rawTx;
  }

  // Query Methods
  async getState(chainId: InjectiveChainKey): Promise<State> {
    return this.chainGrpcWasmApi.fetchSmartContractState(
      this.config.getChainConfig(chainId).addresses.assetManager,
      toBase64({
        get_state: {},
      }),
    ) as unknown as Promise<State>;
  }

  /**
   * Sends a message to the hub chain.
   * @param {SendMessageParams<InjectiveChainKey, R>} params - The parameters for the call wallet, including:
   *   - {FromParams<InjectiveChainKey>} fromParams: The parameters for the from chain.
   *   - {HubChainKey} dstChainKey: The chain key of the hub chain.
   *   - {HubAddress} dstAddress: The address on the hub chain.
   *   - {Hex} payload: The payload to send.
   *   - {boolean} raw: The return type raw or just transaction hash.
   * @returns {Promise<TxReturnType<InjectiveChainKey, R>>} A promise that resolves to the transaction hash.
   */
  async sendMessage<Raw extends boolean>(
    params: SendMessageParams<InjectiveChainKey, Raw>,
  ): Promise<TxReturnType<InjectiveChainKey, Raw>> {
    const { srcAddress: from, srcChainKey, dstChainKey, dstAddress, payload } = params;
    const relayId = getIntentRelayChainId(dstChainKey);

    const msg: ConnMsg = {
      send_message: {
        dst_chain_id: Number(relayId),
        dst_address: Array.from(fromHex(dstAddress, 'bytes')),
        payload: Array.from(fromHex(payload, 'bytes')),
      },
    };

    const chainConfig = this.config.getChainConfig(srcChainKey);

    if (params.raw === true) {
      return (await this.getRawTransaction(
        chainConfig.networkId,
        from,
        chainConfig.addresses.connection,
        msg,
      )) satisfies TxReturnType<InjectiveChainKey, true> as TxReturnType<InjectiveChainKey, Raw>;
    }

    const res = await params.walletProvider.execute(from, chainConfig.addresses.connection, msg);
    return res.transactionHash satisfies TxReturnType<InjectiveChainKey, false> as TxReturnType<InjectiveChainKey, Raw>;
  }

  async receiveMessage(
    senderAddress: string,
    srcChainKey: InjectiveChainKey,
    srcAddress: Uint8Array,
    connSn: string,
    payload: Uint8Array,
    signatures: Uint8Array[],
    walletProvider: IInjectiveWalletProvider,
  ): Promise<InjectiveExecuteResponse> {
    const msg: ExecuteMsg = {
      recv_message: {
        src_chain_id: srcChainKey,
        src_address: srcAddress,
        conn_sn: connSn,
        payload,
        signatures,
      },
    };

    return await walletProvider.execute(
      senderAddress,
      this.config.getChainConfig(srcChainKey).addresses.assetManager,
      msg,
    );
  }

  async setRateLimit(
    chainId: InjectiveChainKey,
    senderAddress: string,
    rateLimit: string,
    walletProvider: IInjectiveWalletProvider,
  ): Promise<InjectiveExecuteResponse> {
    const msg: ExecuteMsg = {
      set_rate_limit: {
        rate_limit: rateLimit,
      },
    };

    return await walletProvider.execute(senderAddress, this.config.getChainConfig(chainId).addresses.assetManager, msg);
  }

  async setConnection(
    chainId: InjectiveChainKey,
    senderAddress: string,
    connection: string,
    walletProvider: IInjectiveWalletProvider,
  ): Promise<InjectiveExecuteResponse> {
    const msg: ExecuteMsg = {
      set_connection: {
        connection,
      },
    };

    return await walletProvider.execute(senderAddress, this.config.getChainConfig(chainId).addresses.assetManager, msg);
  }

  async setOwner(
    senderAddress: string,
    owner: string,
    chainId: InjectiveChainKey,
    walletProvider: IInjectiveWalletProvider,
  ): Promise<InjectiveExecuteResponse> {
    const msg: ExecuteMsg = {
      set_owner: {
        owner,
      },
    };

    return await walletProvider.execute(senderAddress, this.config.getChainConfig(chainId).addresses.assetManager, msg);
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<InjectiveChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<InjectiveChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;
    const deadline = Date.now() + maxTimeoutMs;

    while (Date.now() < deadline) {
      try {
        const tx = await this.txClient.fetchTx(txHash);
        if (tx) {
          if (tx.code === 0) {
            return { ok: true, value: { status: 'success', receipt: tx } };
          }
          return {
            ok: true,
            value: { status: 'failure', error: new Error(`Transaction failed with code ${tx.code}: ${tx.rawLog}`) },
          };
        }
      } catch {
        // Transaction not yet indexed — retry
      }
      await sleep(pollingIntervalMs);
    }

    return {
      ok: true,
      value: {
        status: 'timeout',
        error: new Error(`Timed out after ${maxTimeoutMs}ms waiting for Injective transaction ${txHash}`),
      },
    };
  }
}
