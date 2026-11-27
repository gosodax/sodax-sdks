import { fromHex, toHex, type Hex } from 'viem';
import type {
  EstimateGasParams,
  GetDepositParams,
  GetBalanceParams,
  GetBalancesParams,
  DepositParams,
  SendMessageParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { CustomSorobanServer } from '../../entities/stellar/CustomSorobanServer.js';
import { parseToStroops, sleep } from '../../utils/shared-utils.js';
import {
  rpc,
  Asset,
  Contract,
  Address,
  FeeBumpTransaction,
  nativeToScVal,
  TimeoutInfinite,
  scValToBigInt,
  Horizon,
  Account,
  Operation,
  type xdr,
  type Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  ChainKeys,
  getIntentRelayChainId,
  isNativeToken,
  type IStellarWalletProvider,
  type Result,
  type StellarChainKey,
  type StellarGasEstimate,
  type StellarSorobanTransactionReceipt,
  type StellarSpokeChainConfig,
  type TxReturnType,
  type WalletProviderSlot,
} from '@sodax/types';

/** Base reserve in stroops (0.5 XLM). Each subentry (trustline, signer, data entry, offer) adds one base reserve. */
const STELLAR_BASE_RESERVE_STROOPS = 5_000_000n;

/** Parse an XLM balance string (e.g. "198.8944970") to stroops (1 XLM = 10^7 stroops). */
function parseXlmBalanceToStroops(balanceStr: string): bigint {
  const [whole = '0', frac = ''] = balanceStr.split('.');
  return BigInt(whole + frac.padEnd(7, '0').slice(0, 7));
}

export class CustomStellarAccount {
  private readonly accountId: string;
  private sequenceNumber: bigint;
  private readonly startingSequenceNumber: bigint;

  constructor({ account_id, sequence }: { account_id: string; sequence: string }) {
    this.accountId = account_id;
    this.sequenceNumber = BigInt(sequence);
    this.startingSequenceNumber = BigInt(sequence);
  }

  getSequenceNumber(): bigint {
    return this.sequenceNumber;
  }

  getStartingSequenceNumber(): bigint {
    return this.startingSequenceNumber;
  }

  getAccountId(): string {
    return this.accountId;
  }

  getAccountClone(): Account {
    return new Account(this.accountId, this.sequenceNumber.toString());
  }

  incrementSequenceNumber(): void {
    this.sequenceNumber++;
  }

  decrementSequenceNumber(): void {
    if (this.sequenceNumber > this.startingSequenceNumber) {
      this.sequenceNumber--;
      return;
    }

    throw new Error(
      `Sequence number cannot be decremented below the starting sequence number: ${this.startingSequenceNumber}`,
    );
  }

  resetSequenceNumber(): void {
    this.sequenceNumber = this.startingSequenceNumber;
  }
}

/** `TransactionBuilder.setTimeout` takes seconds, unlike this service's millisecond timeouts. */
const TRUSTLINE_TX_TIMEOUT_SECONDS = 300;

export type RequestTrustlineParams<S extends StellarChainKey, Raw extends boolean> = {
  srcAddress: string;
  srcChainKey: S;
  token: string;
  amount: bigint;
} & WalletProviderSlot<S, Raw>;

export class StellarSpokeService {
  private readonly config: ConfigService;
  private readonly chainConfig: StellarSpokeChainConfig;
  public readonly server: Horizon.Server;
  public readonly sorobanServer: CustomSorobanServer;
  private readonly pollingIntervalMs: number;
  private readonly maxTimeoutMs: number;
  private readonly priorityFee: string;
  private readonly baseFee: string;

  constructor(config: ConfigService) {
    this.config = config;
    this.chainConfig = config.getChainConfig(ChainKeys.STELLAR_MAINNET);

    // Only mainnet is supported, so the single Stellar chain config is used.
    this.server = new Horizon.Server(this.chainConfig.horizonRpcUrl, {
      allowHttp: true,
    });
    this.sorobanServer = new CustomSorobanServer(this.chainConfig.sorobanRpcUrl, {});
    this.pollingIntervalMs = this.chainConfig.pollingConfig.pollingIntervalMs;
    this.maxTimeoutMs = this.chainConfig.pollingConfig.maxTimeoutMs;
    this.priorityFee = this.chainConfig.priorityFee;
    this.baseFee = this.chainConfig.baseFee;
  }

  public async getBalance(params: GetDepositParams<StellarChainKey>): Promise<number> {
    const contract = new Contract(this.config.getChainConfig(params.srcChainKey).addresses.assetManager);
    const [network, sourceAccount] = await Promise.all([
      this.sorobanServer.getNetwork(),
      this.sorobanServer.getAccount(params.srcAddress),
    ]);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: this.baseFee,
      networkPassphrase: network.passphrase,
    })
      .addOperation(contract.call('get_token_balance', nativeToScVal(params.srcAddress, { type: 'address' })))
      .setTimeout(TimeoutInfinite)
      .build();

    const result = await this.sorobanServer.simulateTransaction(tx);

    // Also throws on restore responses — invalid for read-only balance simulation
    if (!rpc.Api.isSimulationSuccess(result)) {
      throw new Error('Failed to simulate transaction');
    }

    const resultValue = result.result;

    if (resultValue) {
      return Number(scValToBigInt(resultValue.retval));
    }

    throw new Error('result undefined');
  }

  /** Native XLM returns the spendable amount via Horizon; other assets the Soroban token contract's `balance`. */
  public async getWalletBalance(params: GetBalanceParams<StellarChainKey>): Promise<bigint> {
    const { srcChainKey, srcAddress, token } = params;

    if (isNativeToken(srcChainKey, token)) {
      return StellarSpokeService.spendableXlmStroops(await this.server.loadAccount(srcAddress));
    }

    const [network, sourceAccount] = await Promise.all([
      this.sorobanServer.getNetwork(),
      this.sorobanServer.getAccount(srcAddress),
    ]);
    return this.simulateTokenBalance(
      token.address,
      srcAddress,
      new CustomStellarAccount({ account_id: sourceAccount.accountId(), sequence: sourceAccount.sequenceNumber() }),
      network.passphrase,
    );
  }

  /** Native balance minus minimum reserve and selling liabilities — the network refuses to release reserves. */
  private static spendableXlmStroops(account: Horizon.AccountResponse): bigint {
    const nativeBalance = account.balances.find(
      (balance): balance is Horizon.HorizonApi.BalanceLineNative => balance.asset_type === 'native',
    );
    if (!nativeBalance) {
      return 0n;
    }

    const rawStroops = parseXlmBalanceToStroops(nativeBalance.balance);
    const sellingLiabilitiesStroops = nativeBalance.selling_liabilities
      ? parseXlmBalanceToStroops(nativeBalance.selling_liabilities)
      : 0n;
    // Minimum balance = (2 + subentry_count + num_sponsoring - num_sponsored) * base_reserve + selling_liabilities.
    // Sponsored reserves are paid by the sponsor, so they are not subtracted.
    const reserveCount = Math.max(0, 2 + account.subentry_count + account.num_sponsoring - account.num_sponsored);
    const minStroops = BigInt(reserveCount) * STELLAR_BASE_RESERVE_STROOPS + sellingLiabilitiesStroops;
    return rawStroops > minStroops ? rawStroops - minStroops : 0n;
  }

  /**
   * Each builder needs its own `getAccountClone()`: `TransactionBuilder.build()` increments the source's sequence
   * number, so concurrent builders on a shared `Account` would interleave.
   */
  private async simulateTokenBalance(
    tokenAddress: string,
    srcAddress: string,
    account: CustomStellarAccount,
    networkPassphrase: string,
  ): Promise<bigint> {
    const contract = new Contract(tokenAddress);
    const tx = new TransactionBuilder(account.getAccountClone(), { fee: this.baseFee, networkPassphrase })
      .addOperation(contract.call('balance', nativeToScVal(srcAddress, { type: 'address' })))
      .setTimeout(TimeoutInfinite)
      .build();

    const result = await this.sorobanServer.simulateTransaction(tx);
    // Also throws on restore responses — invalid for a read-only balance simulation.
    if (!rpc.Api.isSimulationSuccess(result)) {
      throw new Error('Failed to simulate transaction');
    }
    // A success with no return value is a malformed read, not a zero balance (`0n` means confirmed zero).
    if (!result.result) {
      throw new Error('Failed to read token balance: simulation returned no result');
    }
    return scValToBigInt(result.result.retval);
  }

  /** Passphrase and source account are fetched once per batch, and only if needed (all-native issues no Soroban calls). */
  public async getWalletBalances(params: GetBalancesParams<StellarChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;

    const nativeTokens = tokens.filter(token => isNativeToken(srcChainKey, token));
    const sorobanTokens = tokens.filter(token => !isNativeToken(srcChainKey, token));

    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });

    if (nativeTokens.length > 0) {
      // Every native entry resolves from the same Horizon read, so ask once and share the outcome.
      try {
        const spendable = StellarSpokeService.spendableXlmStroops(await this.server.loadAccount(srcAddress));
        for (const token of nativeTokens) {
          collector.ok(token.address, spendable);
        }
      } catch (error) {
        for (const token of nativeTokens) {
          collector.fail(token.address, error);
        }
      }
    }

    if (sorobanTokens.length === 0) {
      return collector.finish();
    }

    const [network, sourceAccount] = await Promise.all([
      this.sorobanServer.getNetwork(),
      this.sorobanServer.getAccount(srcAddress),
    ]);
    const account = new CustomStellarAccount({
      account_id: sourceAccount.accountId(),
      sequence: sourceAccount.sequenceNumber(),
    });

    await settleWalletBalances(collector, sorobanTokens, token =>
      this.simulateTokenBalance(token.address, srcAddress, account, network.passphrase),
    );
    return collector.finish();
  }

  public async buildPriorityStellarTransaction(
    account: CustomStellarAccount,
    network: rpc.Api.GetNetworkResponse,
    operation: xdr.Operation<Operation.InvokeHostFunction>,
  ): Promise<[Transaction, rpc.Api.SimulateTransactionResponse]> {
    const simulationForFee = await this.sorobanServer.simulateTransaction(
      new TransactionBuilder(account.getAccountClone(), {
        fee: this.baseFee,
        networkPassphrase: network.passphrase,
      })
        .addOperation(operation)
        .setTimeout(this.maxTimeoutMs)
        .build(),
    );

    if (!rpc.Api.isSimulationSuccess(simulationForFee)) {
      throw new Error(`Simulation error: ${JSON.stringify(simulationForFee)}`);
    }

    // Fresh account clone: the local sequence increments for every created tx.
    const priorityTransaction = new TransactionBuilder(account.getAccountClone(), {
      fee: (BigInt(simulationForFee.minResourceFee) + BigInt(this.priorityFee) + BigInt(this.baseFee)).toString(),
      networkPassphrase: network.passphrase,
    })
      .addOperation(operation)
      .setTimeout(this.maxTimeoutMs)
      .build();

    const simulation = await this.sorobanServer.simulateTransaction(priorityTransaction);

    return [priorityTransaction, simulation];
  }

  public buildDepositCall<Raw extends boolean>(
    params: DepositParams<StellarChainKey, Raw>,
  ): xdr.Operation<Operation.InvokeHostFunction> {
    const contract = new Contract(this.config.getChainConfig(params.srcChainKey).addresses.assetManager);
    return contract.call(
      'transfer',
      nativeToScVal(Address.fromString(params.srcAddress), { type: 'address' }),
      nativeToScVal(Address.fromString(params.token), {
        type: 'address',
      }),
      nativeToScVal(BigInt(params.amount), { type: 'u128' }),
      nativeToScVal(Buffer.from(fromHex(params.to, 'bytes')), { type: 'bytes' }),
      nativeToScVal(Buffer.from(fromHex(params.data, 'bytes')), { type: 'bytes' }),
    );
  }

  public buildSendMessageCall<Raw extends boolean>(
    params: SendMessageParams<StellarChainKey, Raw>,
  ): xdr.Operation<Operation.InvokeHostFunction> {
    const connection = new Contract(this.chainConfig.addresses.connection);

    return connection.call(
      'send_message',
      nativeToScVal(Address.fromString(params.srcAddress), { type: 'address' }),
      nativeToScVal(BigInt(getIntentRelayChainId(params.dstChainKey)), { type: 'u128' }),
      nativeToScVal(Buffer.from(fromHex(params.dstAddress, 'bytes')), { type: 'bytes' }),
      nativeToScVal(Buffer.from(fromHex(params.payload, 'bytes')), { type: 'bytes' }),
    );
  }

  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<StellarChainKey, Raw>,
  ): Promise<TxReturnType<StellarChainKey, Raw>> {
    try {
      const { srcAddress: from, srcChainKey } = params;
      const [network, accountResponse] = await Promise.all([
        this.sorobanServer.getNetwork(),
        this.server.loadAccount(from),
      ]);
      const stellarAccount = new CustomStellarAccount(accountResponse);

      const sendMessageCall = this.buildSendMessageCall(params);

      const [rawPriorityTx, simulation] = await this.buildPriorityStellarTransaction(
        stellarAccount,
        network,
        sendMessageCall,
      );

      const assembledPriorityTx = rpc.assembleTransaction(rawPriorityTx, simulation).build();

      if (params.raw) {
        const transactionXdr = assembledPriorityTx.toXDR();

        return {
          from: from,
          to: this.config.getChainConfig(srcChainKey).addresses.assetManager,
          value: 0n,
          data: transactionXdr,
        } satisfies TxReturnType<StellarChainKey, true> as TxReturnType<StellarChainKey, Raw>;
      }

      const walletProvider = params.walletProvider;
      const hash = await this.submitOrRestoreAndRetry(
        walletProvider,
        stellarAccount,
        network,
        assembledPriorityTx,
        sendMessageCall,
        simulation,
      );

      return `${hash}` satisfies TxReturnType<StellarChainKey, false> as TxReturnType<StellarChainKey, Raw>;
    } catch (error) {
      this.config.logger.error('Error during sendMessage', error);
      throw error;
    }
  }

  private handleSendTransactionError(response: rpc.Api.SendTransactionResponse): rpc.Api.SendTransactionResponse {
    if (response.status === 'ERROR') {
      this.config.logger.error(JSON.stringify(response, null, 2));
      throw new Error(JSON.stringify(response, null, 2));
    }

    return response;
  }

  public async signAndSendTransaction(
    walletProvider: IStellarWalletProvider,
    tx: Transaction | FeeBumpTransaction,
    waitForTransaction = true,
  ): Promise<string> {
    const signedTransaction = await walletProvider.signTransaction(tx.toXDR());
    const signedTx = TransactionBuilder.fromXDR(signedTransaction, tx.networkPassphrase) as Transaction;

    const response = this.handleSendTransactionError(await this.sorobanServer.sendTransaction(signedTx));

    if (waitForTransaction) {
      const result = await this.waitForTransactionReceipt({
        txHash: response.hash,
        chainKey: ChainKeys.STELLAR_MAINNET,
      });
      if (result.ok && result.value.status === 'success') {
        return response.hash;
      }
      const error = result.ok && 'error' in result.value ? result.value.error : new Error('Transaction failed');
      throw error;
    }

    return response.hash;
  }

  public async submitOrRestoreAndRetry(
    walletProvider: IStellarWalletProvider,
    account: CustomStellarAccount,
    network: rpc.Api.GetNetworkResponse,
    tx: Transaction,
    operation: xdr.Operation<Operation.InvokeHostFunction>,
    simulation?: rpc.Api.SimulateTransactionResponse,
  ): Promise<string> {
    const initialSimulation = simulation ?? (await this.sorobanServer.simulateTransaction(tx));

    if (!rpc.Api.isSimulationSuccess(initialSimulation)) {
      throw new Error(
        `[StellarSpokeProvider.submitOrRestoreAndRetry] Simulation Failed: ${JSON.stringify(initialSimulation)}`,
      );
    }

    let restored = false;
    if (rpc.Api.isSimulationRestore(initialSimulation)) {
      try {
        await this.handleSimulationRestore(
          walletProvider,
          initialSimulation.restorePreamble.minResourceFee,
          initialSimulation.restorePreamble.transactionData.build(),
          account,
          network,
        );
        restored = true;
      } catch (error) {
        throw new Error(
          `[StellarSpokeProvider.submitOrRestoreAndRetry] Simulation Restore Failed: ${JSON.stringify(error)}`,
        );
      }
    }

    if (!restored) {
      return await this.signAndSendTransaction(walletProvider, tx);
    }

    // The restore tx consumed the current sequence number.
    const newAccount = account.getAccountClone();
    newAccount.incrementSequenceNumber();

    return await this.signAndSendTransaction(
      walletProvider,
      new TransactionBuilder(newAccount, {
        fee: this.baseFee,
        networkPassphrase: network.passphrase,
      })
        .addOperation(operation)
        .setTimeout(this.maxTimeoutMs)
        .build(),
    );
  }

  private async handleSimulationRestore(
    walletProvider: IStellarWalletProvider,
    minResourceFee: string,
    transactionData: xdr.SorobanTransactionData,
    account: CustomStellarAccount,
    network: rpc.Api.GetNetworkResponse,
  ): Promise<string> {
    // Build the restoration operation using the RPC server's hints.
    const totalFee = (BigInt(this.baseFee) + BigInt(this.priorityFee) + BigInt(minResourceFee)).toString();

    return this.signAndSendTransaction(
      walletProvider,
      new TransactionBuilder(account.getAccountClone(), { fee: totalFee })
        .setNetworkPassphrase(network.passphrase)
        .setSorobanData(transactionData)
        .addOperation(Operation.restoreFootprint({}))
        .setTimeout(this.maxTimeoutMs)
        .build(),
    );
  }

  static getAddressBCSBytes(stellaraddress: string): Hex {
    return `0x${Address.fromString(stellaraddress).toScVal().toXDR('hex')}`;
  }

  static getTsWalletBytes(stellaraddress: string): Hex {
    return toHex(Buffer.from(stellaraddress, 'hex'));
  }

  public async deposit<R extends boolean = false>(
    params: DepositParams<StellarChainKey, R>,
  ): Promise<TxReturnType<StellarChainKey, R>> {
    try {
      const { srcAddress: from, srcChainKey, amount } = params;
      const network = await this.sorobanServer.getNetwork();

      const accountResponse = await this.server.loadAccount(from);
      const stellarAccount = new CustomStellarAccount(accountResponse);

      const depositCall = this.buildDepositCall(params);
      const [rawPriorityTx, simulation] = await this.buildPriorityStellarTransaction(
        stellarAccount,
        network,
        depositCall,
      );

      const assembledPriorityTx = rpc.assembleTransaction(rawPriorityTx, simulation).build();

      if (params.raw) {
        const transactionXdr = assembledPriorityTx.toXDR();

        return {
          from: from,
          to: this.config.getChainConfig(srcChainKey).addresses.assetManager,
          value: BigInt(amount),
          data: transactionXdr,
        } satisfies TxReturnType<StellarChainKey, true> as TxReturnType<StellarChainKey, R>;
      }

      const walletProvider = params.walletProvider;
      const hash = await this.submitOrRestoreAndRetry(
        walletProvider,
        stellarAccount,
        network,
        assembledPriorityTx,
        depositCall,
        simulation,
      );

      return `${hash}` satisfies TxReturnType<StellarChainKey, false> as TxReturnType<StellarChainKey, R>;
    } catch (error) {
      this.config.logger.error('Error during deposit', error);
      throw error;
    }
  }

  /** Native XLM and legacy bnUSD are exempt, so they need no subentry reserve. */
  public requiresTrustline(token: string): boolean {
    const stellarChainConfig = this.chainConfig;
    const normalized = token.toLowerCase();
    if (normalized === stellarChainConfig.nativeToken.toLowerCase()) return false;
    const legacyBnUSD = stellarChainConfig.supportedTokens.legacybnUSD;
    return legacyBnUSD === undefined || normalized !== legacyBnUSD.address.toLowerCase();
  }

  public async hasSufficientTrustline(token: string, amount: bigint, walletAddress: string): Promise<boolean> {
    const stellarChainConfig = this.chainConfig;
    if (!this.requiresTrustline(token)) {
      return true;
    }

    const trustlineConfig = stellarChainConfig.trustlineConfigs.find(
      config => config.contractId.toLowerCase() === token.toLowerCase(),
    );

    if (!trustlineConfig) {
      throw new Error(`Trustline config not found for token: ${token}`);
    }

    const { balances } = await this.server.accounts().accountId(walletAddress).call();

    const tokenBalance = balances.find(
      balance =>
        'limit' in balance &&
        'balance' in balance &&
        'asset_code' in balance &&
        trustlineConfig.assetCode.toLowerCase() === balance.asset_code?.toLowerCase() &&
        'asset_issuer' in balance &&
        trustlineConfig.assetIssuer.toLowerCase() === balance.asset_issuer?.toLowerCase(),
    ) as Horizon.HorizonApi.BalanceLineAsset<'credit_alphanum4' | 'credit_alphanum12'> | undefined;

    if (!tokenBalance) {
      this.config.logger.error(`No token balances found for token: ${token}`);
      return false;
    }

    const limit = parseToStroops(tokenBalance.limit);
    const balance = parseToStroops(tokenBalance.balance);
    const availableTrustAmount: bigint = limit - balance;

    return availableTrustAmount >= amount;
  }

  public async requestTrustline<Raw extends boolean>(
    params: RequestTrustlineParams<StellarChainKey, Raw>,
  ): Promise<TxReturnType<StellarChainKey, Raw>> {
    try {
      const { srcAddress: from, srcChainKey, token, amount } = params;
      const asset = this.config
        .getChainConfig(srcChainKey)
        .trustlineConfigs.find(t => t.contractId.toLowerCase() === token.toLowerCase());

      if (!asset) {
        throw new Error(`Asset ${token} not found. Cannot proceed with trustline.`);
      }

      const [network, accountResponse] = await Promise.all([
        this.sorobanServer.getNetwork(),
        this.server.loadAccount(from),
      ]);

      const stellarAccount = new CustomStellarAccount(accountResponse);

      const transaction = new TransactionBuilder(stellarAccount.getAccountClone(), {
        fee: this.baseFee,
        networkPassphrase: network.passphrase,
      })
        .addOperation(
          Operation.changeTrust({
            asset: new Asset(asset?.assetCode, asset?.assetIssuer),
          }),
        )
        .setTimeout(TRUSTLINE_TX_TIMEOUT_SECONDS)
        .build();

      if (params.raw) {
        const transactionXdr = transaction.toXDR();

        return {
          from: from,
          to: this.config.getChainConfig(srcChainKey).addresses.assetManager,
          value: amount,
          data: transactionXdr,
        } satisfies TxReturnType<StellarChainKey, true> as TxReturnType<StellarChainKey, Raw>;
      }

      const walletProvider = params.walletProvider;
      const hash = await this.signAndSendTransaction(walletProvider, transaction);

      return `${hash}` satisfies TxReturnType<StellarChainKey, false> as TxReturnType<StellarChainKey, Raw>;
    } catch (error) {
      this.config.logger.error('Error during requestTrustline', error);
      throw error;
    }
  }

  /** Returns the minResourceFee. */
  public async estimateGas(params: EstimateGasParams<StellarChainKey>): Promise<StellarGasEstimate> {
    const network = await this.sorobanServer.getNetwork();
    let tx: Transaction | FeeBumpTransaction = TransactionBuilder.fromXDR(params.tx.data, network.passphrase);

    if (tx instanceof FeeBumpTransaction) {
      tx = tx.innerTransaction;
    }

    const simulationForFee = await this.sorobanServer.simulateTransaction(tx);

    if (!rpc.Api.isSimulationSuccess(simulationForFee)) {
      throw new Error(`Simulation error: ${JSON.stringify(simulationForFee)}`);
    }

    return BigInt(simulationForFee.minResourceFee);
  }

  /** Balance of the token in the spoke chain asset manager. */
  public async getDeposit(params: GetDepositParams<StellarChainKey>): Promise<bigint> {
    return BigInt(await this.getBalance(params));
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<StellarChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<StellarChainKey>>> {
    const { txHash, pollingIntervalMs = this.pollingIntervalMs, maxTimeoutMs = this.maxTimeoutMs } = params;
    const maxAttempts = Math.round(maxTimeoutMs / pollingIntervalMs);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tx = await this.sorobanServer.getTransaction(txHash);

        if (tx && tx.status === 'SUCCESS') {
          return { ok: true, value: { status: 'success', receipt: tx satisfies StellarSorobanTransactionReceipt } };
        }

        if (tx && tx.status === 'FAILED') {
          return {
            ok: true,
            value: { status: 'failure', error: new Error(`Transaction failed: ${JSON.stringify(tx)}`) },
          };
        }

        if (tx && tx.status === 'NOT_FOUND') {
          await sleep(pollingIntervalMs);
          continue;
        }

        await sleep(pollingIntervalMs);
      } catch {
        await sleep(pollingIntervalMs);
      }
    }

    return {
      ok: true,
      value: { status: 'timeout', error: new Error(`Transaction was not confirmed within ${maxAttempts} attempts`) },
    };
  }
}
