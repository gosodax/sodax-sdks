import {
  type Address,
  type Hex,
  type HttpTransport,
  type PublicClient,
  createPublicClient,
  encodeFunctionData,
  http,
  parseEventLogs,
} from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  type EvmReturnType,
  type MonadChainKey,
  type MonadSpokeChainConfig,
  type Result,
  type TxReturnType,
} from '@sodax/types';
import { erc20Abi } from '../../abis/index.js';
import type { ConfigService } from '../../config/ConfigService.js';
import { getEvmViemChain } from '../../utils/constant-utils.js';
import { retry } from '../../utils/shared-utils.js';
import type {
  DepositParams,
  EstimateGasParams,
  GetDepositParams,
  SendMessageParams,
  WaitForTxReceiptParams,
  WaitForTxReceiptReturnType,
} from '../../types/spoke-types.js';
import {
  getDeposit,
  getDepositAddress,
  getWithdrawal,
  notify,
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
import { computeSignedMessageHash, randomWithdrawNonce } from './mpc-message.js';

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout.
 *
 * Monad blocks are fast, but the relay waits on confirmations, aggregation, the NEAR submit and the
 * hub tx, so the generic cross-chain timeout would give up mid-flight.
 */
const MONAD_SETTLEMENT_FLOOR_MS = 300_000;

/** How often to re-notify the relay while waiting for a deposit. */
const RENOTIFY_INTERVAL_MS = 6_000;

/**
 * Spoke service for Monad. Monad is EVM for wallets and addresses, but it has no spoke contracts:
 * deposits and withdrawals go through the **MPC relay** in address mode.
 *
 * A deposit is a plain transfer — native MON, or an ERC-20 `transfer` — to a deposit address the
 * relay derives for that one payload, which it then sweeps into the shared reserve. Withdrawals are
 * authorized with scheme 0, an EIP-191 `personal_sign` over the message hash.
 *
 * @see MpcRelayApiService for the relay REST flow (deposit-address → notify → poll).
 */
export class MonadSpokeService implements MpcRelaySettlement {
  private readonly config: ConfigService;
  private publicClient?: { rpcUrl: string; client: PublicClient<HttpTransport> };

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live rather than captured in the constructor: `ConfigService` can swap in backend-fetched
  // config after construction.
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
   * Deposit MON or an ERC-20 into the hub via the MPC relay.
   *
   * `Raw: true` returns the unsigned transfer (no wallet needed). `Raw: false` registers the hub
   * `data`, sends the transfer to the derived deposit address, waits for it to land, and notifies the
   * relay — resolving to the source tx hash. An ERC-20 deposit is a direct transfer, so it needs no
   * allowance. After the transfer lands, a failed notify warns and still resolves to the hash, so a retry
   * cannot send it twice: `settle` re-notifies it, and a caller that does not settle notifies it with
   * `spoke.submitMpcDeposit`.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<MonadChainKey, R>,
  ): Promise<TxReturnType<MonadChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;

    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    if (addr.value.depositMethod !== 'address') {
      throw new Error(
        `[MonadSpokeService.deposit] relay returned a ${addr.value.depositMethod}-mode deposit, expected address`,
      );
    }
    const { depositAddress, hubWallet } = addr.value;

    // The relay derives the receiving hub wallet from `srcAddress` rather than taking `to`, so `to`
    // is an assertion: a mismatch means the identity encoding drifted from the relay's.
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[MonadSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    const rawTx: EvmReturnType<true> = this.isNative(token)
      ? { from: srcAddress, to: depositAddress as Address, value: amount, data: '0x' }
      : {
          from: srcAddress,
          to: token as Address,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [depositAddress as Address, amount],
          }),
        };

    if ('raw' in params && params.raw) {
      return rawTx satisfies EvmReturnType<true> as TxReturnType<MonadChainKey, R>;
    }

    const txHash = await params.walletProvider.sendTransaction(rawTx);

    // Notify only a transfer that actually landed: a reverted ERC-20 transfer moved nothing, and the
    // relay would record a deposit that never attests.
    const receipt = await this.getPublicClient().waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new Error(`[MonadSpokeService.deposit] deposit transfer ${txHash} reverted`);
    }

    const submitted = await this.submitDeposit(txHash);
    if (!submitted.ok) {
      this.config.logger.warn('[MonadSpokeService.deposit] relay notify failed; settle or submitMpcDeposit re-notifies it', {
        txHash,
        error: submitted.error,
      });
    }

    return txHash satisfies Hex as TxReturnType<MonadChainKey, R>;
  }

  /**
   * Notify the relay of a landed deposit, without waiting for the hub mint. The funds have already moved,
   * so it retries, and a failure keeps the tx hash: the only handle left for re-notifying the deposit.
   */
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

  /** A notify, retried: `retry` reacts to a throw and `notify` reports failure in its Result, so rethrow it. */
  private async retryNotify(send: () => Promise<Result<NotifyResponse>>): Promise<void> {
    await retry(async () => {
      const res = await send();
      if (!res.ok) throw res.error;
    });
  }

  /**
   * The relay's deposit id for `txHash`. A native send has no log and is keyed at index 0; an ERC-20
   * deposit is keyed by the block-level index of its `Transfer` log from a supported token.
   */
  private async depositIdFor(txHash: string, { wait }: { wait: boolean }): Promise<string> {
    const client = this.getPublicClient();
    const hash = txHash as Hex;
    const receipt = wait ? await client.waitForTransactionReceipt({ hash }) : await client.getTransactionReceipt({ hash });
    const tokens = new Set(
      Object.values(this.chainConfig.supportedTokens)
        .map(t => t.address.toLowerCase())
        .filter(a => !this.isNative(a)),
    );
    const transfer = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).find(log =>
      tokens.has(log.address.toLowerCase()),
    );
    return toDepositId(this.chainId, txHash, transfer?.logIndex ?? 0);
  }

  /**
   * Wait for the hub mint to land for a Monad deposit, via the MPC relay's deposit record.
   * `txHash` is the source tx hash returned by {@link deposit}.
   */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    // `/notify` accepts a tx before it is confirmed and never re-checks, so a notification sent right
    // after the transfer can land too early. Re-notifying is idempotent.
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, txHash);
    }, RENOTIFY_INTERVAL_MS);

    try {
      const depositId = await this.depositIdFor(txHash, { wait: true });
      return await waitForDeposit(this.relayApiUrl, depositId, {
        timeout: Math.max(timeout ?? 0, MONAD_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } catch (error) {
      return { ok: false, error };
    } finally {
      clearInterval(renotify);
    }
  }

  /** The MPC relay's current record for a Monad deposit, read once. `txHash` is as for {@link waitForDeposit}. */
  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    try {
      return await getDeposit(this.relayApiUrl, await this.depositIdFor(txHash, { wait: false }));
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * On-chain balance of `token` for the deposit owner. Monad has no spoke asset manager holding
   * deposits, so this reads the holder's own balance — native MON, or `balanceOf` for an ERC-20.
   */
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

  /** Gas for the deposit transfer, from the node. */
  public async estimateGas({ tx }: EstimateGasParams<MonadChainKey>): Promise<bigint> {
    return this.getPublicClient().estimateGas({ account: tx.from, to: tx.to, value: tx.value, data: tx.data });
  }

  /**
   * Withdraw / borrow (hub→Monad) via the MPC relay's signature-mode pipeline.
   *
   * The `payload` is the hub-wallet calls to run; `dstAddress` is the hub wallet that executes them.
   * The Monad account signs the withdraw-auth hash with EIP-191 (scheme 0), and the relay verifies →
   * burns on the hub → MPC-signs the release. Resolves to the `trackingId` to poll
   * {@link waitForWithdrawal} with. Raw mode is not supported — there is no spoke tx to return.
   */
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

    const res = await submitWithdraw(this.relayApiUrl, {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature,
      scheme: getMpcRelayChainInfo(ChainKeys.MONAD_MAINNET).withdrawScheme,
    });
    if (!res.ok) throw res.error;

    return res.value.trackingId satisfies string as TxReturnType<MonadChainKey, Raw>;
  }

  /** The MPC relay's current record for a withdraw-auth, read once. `trackingId` is what {@link sendMessage} returned. */
  public async getWithdrawalRecord(trackingId: string): Promise<Result<WithdrawalRecord>> {
    return getWithdrawal(this.relayApiUrl, trackingId);
  }

  /**
   * Wait for a hub→Monad withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(
    trackingId: string,
    timeout?: number,
    until?: WithdrawalSettledOn,
  ): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      until,
      timeout: Math.max(timeout ?? 0, MONAD_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /**
   * Notify the relay of a hub tx releasing to Monad, without waiting for the release. The relay has no hub
   * watcher and learns of the hub tx only through `/notify`.
   */
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

  /**
   * Wait until a release {@link submitHubRelease} notified is paid. The relay's verifier also waits on hub
   * confirmations and may have dropped an early notify, so this keeps re-notifying.
   */
  public async waitForHubRelease(release: HubRelease, timeout?: number): Promise<Result<DepositRecord>> {
    const { hubChainId, hubTxHash } = release;
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, hubChainId, hubTxHash, 'withdrawal');
    }, RENOTIFY_INTERVAL_MS);
    try {
      return await waitForHubRelease(this.relayApiUrl, release, {
        timeout: Math.max(timeout ?? 0, MONAD_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  /** One read of a hub release's record through the relay, which `txs.release` marks as paid. */
  public async getHubReleaseRecord(release: HubRelease): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toHubReleaseId(release));
  }

  /** Wait until the transaction is mined, mapping the receipt to the SDK shape. */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<MonadChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<MonadChainKey>>> {
    try {
      const receipt = await this.getPublicClient().waitForTransactionReceipt({
        hash: params.txHash as Hex,
        pollingInterval: params.pollingIntervalMs,
        timeout: params.maxTimeoutMs,
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
