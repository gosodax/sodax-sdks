import {
  Cl,
  noneCV,
  Pc,
  PostConditionMode,
  someCV,
  uintCV,
  type ContractIdString,
  type ClarityValue,
  type PostCondition,
  fetchCallReadOnlyFunction,
  parseContractId,
  type ContractPrincipalCV,
  type UIntCV,
  makeUnsignedContractCall,
  fetchFeeEstimateTransaction,
  getAddressFromPublicKey,
  serializePayloadBytes,
  type StacksNetwork,
  createNetwork,
} from '@sodax/libs/stacks/core';
import { getIntentRelayChainId, isNativeToken, ChainKeys } from '@sodax/types';
import type {
  FeeEstimateTransaction,
  Result,
  StacksChainKey,
  StacksRawTransactionReceipt,
  StacksReturnType,
  StacksTransactionParams,
  TxReturnType,
} from '@sodax/types';
import { sleep } from '../../utils/shared-utils.js';
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
import { bytesToHex } from 'viem';

export class StacksSpokeService {
  private readonly config: ConfigService;
  protected network: StacksNetwork;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;

  constructor(config: ConfigService) {
    this.config = config;
    // since we only support mainnet for now, we can hardcode the single stacks chain config
    const chainConfig = config.getChainConfig(ChainKeys.STACKS_MAINNET);
    this.network = createNetwork({ network: 'mainnet', client: { baseUrl: chainConfig.rpcUrl } });
    this.pollingIntervalMs = chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = chainConfig.pollingConfig.maxTimeoutMs;
  }

  public async estimateGas(params: EstimateGasParams<StacksChainKey>): Promise<FeeEstimateTransaction> {
    const [low, medium, high] = await fetchFeeEstimateTransaction({
      payload: params.tx.payload,
      estimatedLength: params.tx.estimatedLength,
      network: this.network,
    });

    return { low, medium, high };
  }

  async readContract(sender: string, txParams: StacksTransactionParams): Promise<ClarityValue> {
    return fetchCallReadOnlyFunction({
      contractAddress: txParams.contractAddress,
      contractName: txParams.contractName,
      functionName: txParams.functionName,
      functionArgs: txParams.functionArgs,
      network: this.network,
      senderAddress: sender,
    });
  }

  async getSTXBalance(address: string): Promise<bigint> {
    const url = `${this.network.client.baseUrl}/extended/v1/address/${address}/balances`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error fetching STX balance: ${response.statusText}`);
    }
    const data = await response.json();
    return BigInt(data.stx.balance);
  }

  async readTokenBalance(token: string, address: string): Promise<bigint> {
    const [contractAddress, contractName] = parseContractId(token as ContractIdString);
    const result = (await fetchCallReadOnlyFunction({
      contractAddress: contractAddress as string,
      contractName: contractName as string,
      functionName: 'get-balance',
      functionArgs: [Cl.principal(address)],
      network: this.network,
      senderAddress: address,
    })) as { value: UIntCV };
    return result.value.value as bigint;
  }

  private readonly ftAssetNames = new Map<string, string[]>();

  /** Post-conditions need the on-chain `define-fungible-token` names; SIP-10 exposes no read for them. */
  private async getFtAssetNames(tokenContractId: string): Promise<string[]> {
    const cached = this.ftAssetNames.get(tokenContractId);
    if (cached) return cached;
    const [address, name] = parseContractId(tokenContractId as ContractIdString);
    const response = await fetch(`${this.network.client.baseUrl}/v2/contracts/interface/${address}/${name}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch the contract interface for ${tokenContractId}: ${response.statusText}`);
    }
    const abi = (await response.json()) as { fungible_tokens?: Array<{ name: string }> };
    const assetNames = (abi.fungible_tokens ?? []).map(token => token.name);
    if (assetNames.length === 0) {
      throw new Error(`${tokenContractId} defines no fungible token — not a SIP-10 contract`);
    }
    this.ftAssetNames.set(tokenContractId, assetNames);
    return assetNames;
  }

  async getImplContractAddress(stateContract: string): Promise<string> {
    const [contractAddress, contractName] = parseContractId(stateContract as ContractIdString);
    const txParams = {
      contractAddress: contractAddress as string,
      contractName: contractName as string,
      functionName: 'get-asset-manager-impl',
      functionArgs: [],
    };

    return ((await this.readContract(contractAddress as string, txParams)) as ContractPrincipalCV).value;
  }

  /**
   * Deposit tokens to the spoke chain.
   * @param {StacksSpokeDepositParams} params - The parameters for the deposit, including the user's address, token address, amount, and additional data.
   * @param {StacksSpokeProviderType} spokeProvider - The provider for the spoke chain.
   * @param {EvmHubProvider} hubProvider - The provider for the hub chain.
   * @returns {Promise<Hash>} A promise that resolves to the transaction hash.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<StacksChainKey, R>,
  ): Promise<TxReturnType<StacksChainKey, R>> {
    const chainConfig = this.config.getChainConfig(params.srcChainKey);
    const assetManagerImpl = await this.getImplContractAddress(chainConfig.addresses.assetManager);
    const [implAddress, implName] = parseContractId(assetManagerImpl as ContractIdString);
    const [connectionAddress, connectionName] = parseContractId(chainConfig.addresses.connection as ContractIdString);
    const isNative = isNativeToken(params.srcChainKey, params.token);
    const reqData = {
      contractAddress: implAddress as string,
      contractName: implName as string,
      functionName: 'transfer',
      functionArgs: [
        isNative ? noneCV() : someCV(Cl.principal(params.token)),
        Cl.bufferFromHex(params.to),
        uintCV(params.amount),
        Cl.bufferFromHex(params.data),
        Cl.contractPrincipal(connectionAddress as string, connectionName as string),
      ],
    };
    // Post-conditions cannot ride the raw return (`serializePayloadBytes` keeps the contract-call
    // payload only), so raw mode skips the interface lookup they would need.
    if (params.raw === true) {
      // srcPublicKey (builds the unsigned tx) and srcAddress (hub-wallet derivation + intent record) must
      // be the same account — derive the address from the key and match, else the user signs a tx for another.
      if (!params.srcPublicKey) {
        throw new Error('Stacks raw transactions require srcPublicKey (the signer public key for srcAddress).');
      }
      let derivedAddress: string;
      try {
        // Reuse the network the service was built with (config-driven) so the address version matches.
        derivedAddress = getAddressFromPublicKey(params.srcPublicKey, this.network);
      } catch (error) {
        throw new Error(`srcPublicKey is not a valid Stacks public key: ${(error as Error).message}`);
      }
      if (derivedAddress !== params.srcAddress) {
        throw new Error(
          `srcPublicKey does not match srcAddress: it derives ${derivedAddress}, but srcAddress is ${params.srcAddress}.`,
        );
      }

      const tx = await makeUnsignedContractCall({
        ...reqData,
        publicKey: params.srcPublicKey,
        network: this.network,
        fee: 0, // placeholder — we'll estimate
        nonce: 0n,
      });

      return {
        payload: bytesToHex(serializePayloadBytes(tx.payload)),
      } satisfies StacksReturnType<true> as StacksReturnType<R>;
    }
    const txId = await params.walletProvider.sendTransaction({
      ...reqData,
      postConditionMode: PostConditionMode.Deny,
      postConditions: await this.depositPostConditions(params.srcAddress, params.token, params.amount, isNative),
    });
    return txId as StacksReturnType<R>;
  }

  /**
   * Caps for a Deny-mode deposit: asset-manager-state.deposit moves exactly `amount` from the
   * caller, so cap the sender at `amount` — one cap per FT the token contract defines (sBTC has
   * two; the unmoved ones pass at 0 trivially), or uSTX for native.
   */
  private async depositPostConditions(
    srcAddress: string,
    token: string,
    amount: bigint,
    isNative: boolean,
  ): Promise<PostCondition[]> {
    if (isNative) return [Pc.principal(srcAddress).willSendLte(amount).ustx()];
    const assetNames = await this.getFtAssetNames(token);
    return assetNames.map(assetName =>
      Pc.principal(srcAddress)
        .willSendLte(amount)
        .ft(token as ContractIdString, assetName),
    );
  }

  /**
   * Get the balance of the token deposited in the spoke chain asset manager.
   * @param {GetDepositParams<StacksChainKey>} params - The parameters for the deposit, including the user's address, token address, and chain id.
   * @returns {Promise<bigint>} The balance of the token.
   */
  public async getDeposit(params: GetDepositParams<StacksChainKey>): Promise<bigint> {
    const assetManager = this.config.getChainConfig(params.srcChainKey).addresses.assetManager;
    if (isNativeToken(params.srcChainKey, params.token)) {
      return this.getSTXBalance(params.srcAddress);
    }
    return this.readTokenBalance(params.token, assetManager);
  }

  /**
   * Get the user's own wallet balance of a token on Stacks, in smallest units. Native STX via the
   * Hiro REST `/extended/v1/address/{addr}/balances` endpoint; SIP-010 fungible tokens via the
   * read-only `get-balance` contract call. Unlike {@link getDeposit}, this reads the holding of
   * `srcAddress` (the user), not the protocol asset manager.
   * @param {GetBalanceParams<StacksChainKey>} params - The chain key, user address, and token.
   * @returns {Promise<bigint>} The token balance in smallest units.
   */
  public async getWalletBalance(params: GetBalanceParams<StacksChainKey>): Promise<bigint> {
    if (isNativeToken(params.srcChainKey, params.token)) {
      return this.getSTXBalance(params.srcAddress);
    }
    return this.readTokenBalance(params.token.address, params.srcAddress);
  }

  /**
   * Get the user's own wallet balances of multiple tokens on Stacks, in smallest units.
   * @param {GetBalancesParams<StacksChainKey>} params - The chain key, user address, and tokens.
   * @returns {Promise<WalletBalanceMap>} A map of token address to balance in smallest units.
   */
  public async getWalletBalances(params: GetBalancesParams<StacksChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token =>
      this.getWalletBalance({ srcChainKey, srcAddress, token }),
    );
    return collector.finish();
  }

  /**
   * Sends a message to the hub chain.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<StacksChainKey, Raw>,
  ): Promise<TxReturnType<StacksChainKey, Raw>> {
    const dstRelayChainId = getIntentRelayChainId(params.dstChainKey);
    const [connectionAddress, connectionName] = parseContractId(
      this.config.getChainConfig(params.srcChainKey).addresses.connection as ContractIdString,
    );
    const reqData: StacksTransactionParams = {
      contractAddress: connectionAddress as string,
      contractName: connectionName as string,
      functionName: 'send-message',
      functionArgs: [uintCV(dstRelayChainId), Cl.bufferFromHex(params.dstAddress), Cl.bufferFromHex(params.payload)],
    };

    if (params.raw === true) {
      // TODO(follow-up): accept srcPublicKey here like deposit() does. Raw sendMessage still overloads
      // srcAddress as the signer public key (money-market / recovery / swap-cancel callers).
      const tx = await makeUnsignedContractCall({
        ...reqData,
        publicKey: params.srcAddress,
        network: this.network,
        fee: 0, // placeholder — we'll estimate
        nonce: 0n,
      });

      return {
        payload: bytesToHex(serializePayloadBytes(tx.payload)),
      } satisfies StacksReturnType<true> as StacksReturnType<Raw>;
    }

    const txId = await params.walletProvider.sendTransaction({
      ...reqData,
      // send-message moves no assets — deny with no conditions aborts if it ever tries.
      postConditionMode: PostConditionMode.Deny,
      postConditions: [],
    });

    return txId satisfies StacksReturnType<false> as StacksReturnType<Raw>;
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<StacksChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<StacksChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;
    const deadline = Date.now() + maxTimeoutMs;
    const url = `${this.network.client.baseUrl}/extended/v1/tx/${txHash}`;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const result = await response.json();
          if (result.tx_status === 'success') {
            return { ok: true, value: { status: 'success', receipt: result satisfies StacksRawTransactionReceipt } };
          }
          if (result.tx_status === 'abort_by_response' || result.tx_status === 'abort_by_post_condition') {
            return {
              ok: true,
              value: { status: 'failure', error: new Error(`Transaction aborted: ${result.tx_status}`) },
            };
          }
        }
      } catch {
        // transient error — retry
      }
      await sleep(pollingIntervalMs);
    }

    return {
      ok: true,
      value: {
        status: 'timeout',
        error: new Error(`Timed out after ${maxTimeoutMs}ms waiting for Stacks transaction ${txHash}`),
      },
    };
  }
}
