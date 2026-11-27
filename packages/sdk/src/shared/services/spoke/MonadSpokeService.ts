import {
  type Address,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type TransactionReceipt,
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  isAddressEqual,
  zeroAddress,
  parseEventLogs,
} from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  isIndeterminateOutcomeError,
  type EvmReturnType,
  type MonadChainKey,
  type MonadSpokeChainConfig,
  type Result,
  type TxReturnType,
} from '@sodax/types';
import { erc20Abi } from '../../abis/index.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { getEvmViemChain } from '../../utils/constant-utils.js';
import { resolveTimeoutMs } from '../../utils/resolveTimeoutMs.js';
import { retry } from '../../utils/shared-utils.js';
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
import {
  getDeposit,
  getDepositAddress,
  getWithdrawal,
  notify,
  submitFreshWithdrawWithBackoff,
  submitWithdraw,
  toDepositId,
  toHubReleaseId,
  waitForDeposit,
  waitForHubRelease,
  waitForWithdrawal,
  type DepositRecord,
  type HubRelease,
  type MpcRelaySettlement,
  type NotifyResponse,
  type WithdrawalRecord,
  type WithdrawalSettledOn,
} from '../mpcRelay/MpcRelayApiService.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import { computeSignedMessageHash, randomWithdrawNonce } from './mpc-message.js';

/** Floor over the caller's settlement timeout: confirmations, aggregation, the NEAR submit and the hub tx outlast it. */
const MONAD_SETTLEMENT_FLOOR_MS = 300_000;
/** How long a deposit waits for its transfer's receipt before notifying the relay anyway. */
const MONAD_DEPOSIT_RECEIPT_TIMEOUT_MS = 60_000;

const RENOTIFY_INTERVAL_MS = 6_000;

/**
 * Monad is EVM for wallets but has no spoke contracts: deposits are plain transfers to a per-payload relay address
 * (MPC relay, address mode), and withdrawals are authorized with scheme 0 (EIP-191 `personal_sign`).
 */
export class MonadSpokeService implements MpcRelaySettlement {
  private readonly config: ConfigService;
  private publicClient?: { rpcUrl: string; client: PublicClient<HttpTransport> };

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live: `ConfigService` can swap in backend-fetched config after construction.
  private get chainConfig(): MonadSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.MONAD_MAINNET);
  }

  private get relayApiUrl(): MonadSpokeChainConfig['mpcRelayApiEndpoint'] {
    return this.chainConfig.mpcRelayApiEndpoint;
  }

  /** The relay's id for this chain (48), not Monad's EVM network id (143). */
  private get chainId(): string {
    return getMpcRelayChainInfo(ChainKeys.MONAD_MAINNET).chainId.toString();
  }

  public getPublicClient(): PublicClient<HttpTransport> {
    const { rpcUrl } = this.chainConfig;
    if (this.publicClient?.rpcUrl !== rpcUrl) {
      const chain = getEvmViemChain(ChainKeys.MONAD_MAINNET);
      this.publicClient = { rpcUrl, client: createPublicClient({ chain, transport: http(rpcUrl) }) };
    }
    return this.publicClient.client;
  }

  private isNative(token: string): boolean {
    return token.toLowerCase() === this.chainConfig.nativeToken.toLowerCase();
  }

  /**
   * Deposit MON or an ERC-20 (direct transfer, no allowance) via the MPC relay. The relay is notified even if the receipt
   * wait fails; an indeterminate receipt or failed notify warns and still resolves to the hash, a definite revert throws.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<MonadChainKey, R>,
  ): Promise<TxReturnType<MonadChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;

    if (
      !Object.values(this.chainConfig.supportedTokens).some(
        entry => entry.address.toLowerCase() === token.toLowerCase(),
      )
    ) {
      throw new Error(`[MonadSpokeService.deposit] unsupported token ${token}`);
    }

    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    if (addr.value.depositMethod !== 'address') {
      throw new Error(
        `[MonadSpokeService.deposit] relay returned a ${addr.value.depositMethod}-mode deposit, expected address`,
      );
    }
    const { depositAddress, hubWallet } = addr.value;
    if (!isAddress(depositAddress) || isAddressEqual(depositAddress, zeroAddress)) {
      throw new Error('[MonadSpokeService.deposit] relay returned an invalid deposit address');
    }

    // The relay derives the hub wallet from `srcAddress`, so `to` is only an assertion; a mismatch means identity drift.
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[MonadSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    const rawTx: EvmReturnType<true> = this.isNative(token)
      ? { from: srcAddress, to: depositAddress, value: amount, data: '0x' }
      : {
          from: srcAddress,
          to: token as Address,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [depositAddress, amount],
          }),
        };

    if ('raw' in params && params.raw) {
      return rawTx satisfies EvmReturnType<true> as TxReturnType<MonadChainKey, R>;
    }

    if (!isAddressEqual(await params.walletProvider.getWalletAddress(), srcAddress)) {
      throw new Error('[MonadSpokeService.deposit] wallet account does not match the source address');
    }
    let txHash: Hex;
    try {
      txHash = await params.walletProvider.sendTransaction(rawTx, {
        expectedChainId: getEvmViemChain(ChainKeys.MONAD_MAINNET).id,
        preserveDepositOutcome: true,
      });
    } catch (error) {
      if (isIndeterminateOutcomeError(error) && error.txHash) {
        await this.submitDeposit(error.txHash);
      }
      throw error;
    }

    let receipt: TransactionReceipt | undefined;
    try {
      receipt = await this.getPublicClient().waitForTransactionReceipt({
        hash: txHash,
        timeout: MONAD_DEPOSIT_RECEIPT_TIMEOUT_MS,
      });
    } catch (error) {
      this.warnDeposit('[MonadSpokeService.deposit] receipt wait failed; notifying the relay with the broadcast hash', {
        txHash,
        error,
      });
    }
    if (receipt && receipt.status !== 'success') {
      throw new Error(`[MonadSpokeService.deposit] deposit transfer ${txHash} reverted`);
    }

    const submitted = await this.submitDeposit(txHash);
    if (!submitted.ok) {
      this.warnDeposit('[MonadSpokeService.deposit] relay notify failed; settle or submitMpcDeposit re-notifies it', {
        txHash,
        error: submitted.error,
      });
    }

    return txHash satisfies Hex as TxReturnType<MonadChainKey, R>;
  }

  private warnDeposit(message: string, context: { txHash: Hex; error: unknown }): void {
    try {
      this.config.logger.warn(message, context);
    } catch {
      // Custom logging must not interrupt settlement of a broadcast deposit.
    }
  }

  /** Notify the relay of a landed deposit with retries; a failure keeps the tx hash, the only handle to re-notify. */
  public async submitDeposit(txHash: string): Promise<Result<void>> {
    try {
      await this.retryNotify(() => notify(this.relayApiUrl, this.chainId, txHash));
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: new Error(`mpc-relay: deposit ${txHash} was not notified — re-notify this tx hash to settle it`, {
          cause: error,
        }),
      };
    }
  }

  /** `retry` reacts to a throw while `notify` reports failure in its Result, so rethrow it. */
  private async retryNotify(send: () => Promise<Result<NotifyResponse>>): Promise<void> {
    await retry(async () => {
      const res = await send();
      if (!res.ok) throw res.error;
    });
  }

  /** A native send is keyed at index 0; an ERC-20 deposit by the block-level index of its `Transfer` log. */
  private async depositIdFor(txHash: string, { waitMs }: { waitMs?: number }): Promise<string> {
    const client = this.getPublicClient();
    const hash = txHash as Hex;
    const receipt =
      waitMs === undefined
        ? await client.getTransactionReceipt({ hash })
        : await client.waitForTransactionReceipt({ hash, timeout: waitMs });
    const tokens = new Set(
      Object.values(this.chainConfig.supportedTokens)
        .map(t => t.address.toLowerCase())
        .filter(a => !this.isNative(a)),
    );
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).filter(log =>
      tokens.has(log.address.toLowerCase()),
    );
    if (transfers.length > 1) {
      throw new Error(
        `[MonadSpokeService] deposit ${txHash} has multiple supported Transfer logs; use its relay log index`,
      );
    }
    return toDepositId(this.chainId, txHash, transfers[0]?.logIndex ?? 0);
  }

  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    // `/notify` accepts a tx before it is confirmed and never re-checks, so re-notify (idempotent).
    void notify(this.relayApiUrl, this.chainId, txHash);
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, txHash);
    }, RENOTIFY_INTERVAL_MS);

    try {
      const budgetMs = Math.max(resolveTimeoutMs(timeout, 0), MONAD_SETTLEMENT_FLOOR_MS);
      const depositId = await this.depositIdFor(txHash, { waitMs: budgetMs });
      return await waitForDeposit(this.relayApiUrl, depositId, {
        timeout: budgetMs,
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } catch (error) {
      return { ok: false, error };
    } finally {
      clearInterval(renotify);
    }
  }

  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    try {
      return await getDeposit(this.relayApiUrl, await this.depositIdFor(txHash, {}));
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Monad has no spoke asset manager, so this reads the holder's own balance. */
  public async getDeposit(params: GetDepositParams<MonadChainKey>): Promise<bigint> {
    const client = this.getPublicClient();
    if (this.isNative(params.token)) {
      return client.getBalance({ address: params.srcAddress });
    }
    return client.readContract({
      address: params.token as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [params.srcAddress],
    });
  }

  public async getWalletBalance(params: GetBalanceParams<MonadChainKey>): Promise<bigint> {
    return this.getDeposit({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      token: params.token.address as Address,
    });
  }

  /** A failed read is logged and left out, unless every read fails. */
  public async getWalletBalances(params: GetBalancesParams<MonadChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  public async estimateGas({ tx }: EstimateGasParams<MonadChainKey>): Promise<bigint> {
    return this.getPublicClient().estimateGas({ account: tx.from, to: tx.to, value: tx.value, data: tx.data });
  }

  /** Withdraw / borrow (hub→Monad) via the MPC relay (scheme 0 EIP-191); resolves to the `trackingId`. Raw mode is unsupported. */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<MonadChainKey, Raw>,
  ): Promise<TxReturnType<MonadChainKey, Raw>> {
    if ('raw' in params && params.raw) {
      throw new Error('[MonadSpokeService.sendMessage] raw mode is not supported for Monad withdrawals');
    }
    const { walletProvider } = params;
    if (!walletProvider.signMessage) {
      throw new Error('[MonadSpokeService.sendMessage] the EVM wallet provider does not implement signMessage');
    }

    const message = {
      to: params.dstAddress as Hex, // hub wallet that executes the calls
      data: params.payload,
      nonce: randomWithdrawNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender: params.srcAddress.toLowerCase() as Hex,
    };

    const signature = await walletProvider.signMessage(computeSignedMessageHash(message));

    const request = {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature,
      scheme: getMpcRelayChainInfo(ChainKeys.MONAD_MAINNET).withdrawScheme,
    };
    const trackingId = await submitFreshWithdrawWithBackoff(async () => {
      const res = await submitWithdraw(this.relayApiUrl, request);
      if (!res.ok) throw res.error;
      return res.value.trackingId;
    });

    return trackingId satisfies string as TxReturnType<MonadChainKey, Raw>;
  }

  public async getWithdrawalRecord(trackingId: string): Promise<Result<WithdrawalRecord>> {
    return getWithdrawal(this.relayApiUrl, trackingId);
  }

  public async waitForWithdrawal(
    trackingId: string,
    timeout?: number,
    until?: WithdrawalSettledOn,
  ): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      until,
      timeout: Math.max(resolveTimeoutMs(timeout, 0), MONAD_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /** Notify the relay of a hub tx releasing to Monad; it has no hub watcher and learns of it only through `/notify`. */
  public async submitHubRelease(release: HubRelease): Promise<Result<void>> {
    const { hubChainId, hubTxHash } = release;
    try {
      await this.retryNotify(() => notify(this.relayApiUrl, hubChainId, hubTxHash, 'withdrawal'));
      return { ok: true, value: undefined };
    } catch (error) {
      // The hub has already burned the tokens; the hash is what a retry has to re-notify.
      return {
        ok: false,
        error: new Error(`mpc-relay: hub tx ${hubTxHash} was not notified — re-notify it to release`, { cause: error }),
      };
    }
  }

  /** Wait until a notified release is paid, re-notifying: the verifier waits on hub confirmations and may drop an early notify. */
  public async waitForHubRelease(release: HubRelease, timeout?: number): Promise<Result<DepositRecord>> {
    const { hubChainId, hubTxHash } = release;
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, hubChainId, hubTxHash, 'withdrawal');
    }, RENOTIFY_INTERVAL_MS);
    try {
      return await waitForHubRelease(this.relayApiUrl, release, {
        timeout: Math.max(resolveTimeoutMs(timeout, 0), MONAD_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  public async getHubReleaseRecord(release: HubRelease): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toHubReleaseId(release));
  }

  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<MonadChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<MonadChainKey>>> {
    try {
      const receipt = await this.getPublicClient().waitForTransactionReceipt({
        hash: params.txHash as Hex,
        pollingInterval: params.pollingIntervalMs,
        timeout: resolveTimeoutMs(params.maxTimeoutMs, MONAD_DEPOSIT_RECEIPT_TIMEOUT_MS),
      });
      if (receipt.status === 'reverted') {
        return { ok: true, value: { status: 'failure', error: new Error('Transaction reverted') } };
      }
      const response = {
        ...receipt,
        transactionIndex: receipt.transactionIndex.toString(),
        blockNumber: receipt.blockNumber.toString(),
        cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
        gasUsed: receipt.gasUsed.toString(),
        contractAddress: receipt.contractAddress?.toString() ?? null,
        logs: receipt.logs.map(log => ({
          ...log,
          blockNumber: log.blockNumber.toString() as Hex,
          logIndex: log.logIndex.toString() as Hex,
          transactionIndex: log.transactionIndex.toString() as Hex,
        })),
        effectiveGasPrice: receipt.effectiveGasPrice?.toString(),
      };
      return { ok: true, value: { status: 'success', receipt: response } };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out');
      return {
        ok: true,
        value: {
          status: isTimeout ? 'timeout' : 'failure',
          error: error instanceof Error ? error : new Error(String(error)),
        },
      };
    }
  }
}
