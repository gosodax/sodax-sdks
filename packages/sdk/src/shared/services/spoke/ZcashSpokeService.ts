import {
  ChainKeys,
  getMpcRelayChainInfo,
  type Result,
  type TxReturnType,
  type ZcashChainKey,
  type ZcashGasEstimate,
  type ZcashRawTransaction,
  type ZcashRawTransactionReceipt,
  type ZcashSpokeChainConfig,
  type ZcashTransparentInput,
  type ZcashUnsignedTransaction,
} from '@sodax/types';
import type { Hex } from 'viem';
import type { ConfigService } from '../../config/ConfigService.js';
import { retry } from '../../utils/shared-utils.js';
import type {
  DepositParams,
  EstimateGasParams,
  GetBalanceParams,
  GetBalancesParams,
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
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import { computeSignedMessageHash, randomWithdrawNonce } from './mpc-message.js';
import {
  ZCASH_DUST_ZATOSHIS,
  parseZcashV5Outputs,
  zcashIdentityBytes,
  zcashP2pkhScript,
  zcashZip317Fee,
} from './zcash-utils.js';

/** Per-request budget for a Zcash RPC call. */
const ZCASH_RPC_TIMEOUT_MS = 20_000;

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout: a Zcash block takes about
 * 75 seconds, and the relay still has to attest, submit to NEAR, mint on the hub and sweep.
 */
const ZCASH_SETTLEMENT_FLOOR_MS = 900_000;

/** How often to re-notify the relay while waiting for a deposit — well under one Zcash block. */
const RENOTIFY_INTERVAL_MS = 30_000;

/** A transaction the sdk builds places the deposit output first, and the relay keys a deposit on its output index. */
const DEPOSIT_OUTPUT_INDEX = 0;

/** How long to wait for the node to see a transaction a wallet broadcast through its own backend. */
const OUTPUT_LOOKUP_ATTEMPTS = 12;
const OUTPUT_LOOKUP_INTERVAL_MS = 5_000;

/** A `getaddressutxos` entry. */
type RpcUtxo = { txid: string; outputIndex: number; script: string; satoshis: number | string };

/** A relay txid in the bare lowercase form the verifier keys deposits on. */
const canonicalTxid = (txid: string): string => txid.replace(/^0x/, '').toLowerCase();

/**
 * Spoke service for Zcash (transparent ZEC). Deposits ride the **MPC relay** in address mode: a v5
 * transaction pays a t-address the relay derives for that one payload, which it then sweeps into its
 * reserve. With a wallet that signs transactions, the service selects UTXOs and builds the transaction; with
 * one that only sends payments (a browser wallet), the wallet builds it and the service finds the deposit output.
 *
 * Withdrawals use scheme 6: a Bitcoin-style `signmessage` over the hex text of the message hash, which the
 * contract recovers to the hash160 identity the sender's t-address encodes.
 *
 * @see MpcRelayApiService for the relay REST flow (deposit-address → notify → poll).
 */
export class ZcashSpokeService implements MpcRelaySettlement {
  private readonly config: ConfigService;
  /** Deposit output index by txid, for deposits made through this instance. */
  private readonly depositOutputs = new Map<string, number>();

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live rather than captured in the constructor: `ConfigService` can swap in backend-fetched
  // config after construction.
  private get chainConfig(): ZcashSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.ZCASH_MAINNET);
  }

  private get relayApiUrl(): ZcashSpokeChainConfig['mpcRelayApiEndpoint'] {
    return this.chainConfig.mpcRelayApiEndpoint;
  }

  /** The relay's id for this chain (133). */
  private get chainId(): string {
    return getMpcRelayChainInfo(ChainKeys.ZCASH_MAINNET).chainId.toString();
  }

  /** One Zcash JSON-RPC call, bounded by a timeout. Needs an endpoint with address indexing. */
  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const { rpcUrl } = this.chainConfig;
    if (!rpcUrl) {
      throw new Error(
        '[ZcashSpokeService] no Zcash RPC configured — set chains.zcash.rpcUrl to an endpoint with address indexing (getaddressutxos)',
      );
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ZCASH_RPC_TIMEOUT_MS);
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '1.0', id: 'sodax', method, params }),
        signal: controller.signal,
      });
      const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string } | null };
      if (body.error) throw new Error(`zcash rpc ${method}: ${body.error.message ?? body.error.code}`);
      if (!res.ok) throw new Error(`zcash rpc ${method}: ${res.status}`);
      return body.result as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`zcash rpc ${method}: timed out after ${ZCASH_RPC_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Spend the largest UTXOs first until they cover `amount` plus the ZIP-317 fee for the resulting shape. A
   * change output below dust is dropped and its value left to the fee rather than creating an unspendable output.
   */
  private selectInputs(
    utxos: ZcashTransparentInput[],
    amount: bigint,
  ): { inputs: ZcashTransparentInput[]; change: bigint } {
    const sorted = [...utxos].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
    const inputs: ZcashTransparentInput[] = [];
    let total = 0n;
    for (const utxo of sorted) {
      inputs.push(utxo);
      total += utxo.value;
      const withChange = total - amount - zcashZip317Fee(inputs.length, 2);
      if (withChange >= ZCASH_DUST_ZATOSHIS) return { inputs, change: withChange };
      if (total - amount - zcashZip317Fee(inputs.length, 1) >= 0n) return { inputs, change: 0n };
    }
    throw new Error(
      `[ZcashSpokeService.deposit] insufficient ZEC: ${total} zatoshis available, ${amount} plus the fee needed`,
    );
  }

  /**
   * Deposit transparent ZEC into the hub via the MPC relay.
   *
   * `Raw: true` returns the transfer descriptor (the derived deposit address and amount). `Raw: false` builds a
   * v5 transaction paying that address, has the wallet sign it, checks the signed bytes pay exactly the deposit
   * address, broadcasts it, and notifies the relay — resolving to the txid. After broadcast, a failed notify
   * warns and still resolves to the txid, so a retry cannot pay twice: `settle` re-notifies it, and a caller that
   * does not settle notifies it with `spoke.submitMpcDeposit`.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<ZcashChainKey, R>,
  ): Promise<TxReturnType<ZcashChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;

    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    if (addr.value.depositMethod !== 'address') {
      throw new Error(
        `[ZcashSpokeService.deposit] relay returned a ${addr.value.depositMethod}-mode deposit, expected address`,
      );
    }
    const { depositAddress, hubWallet, payloadHash } = addr.value;
    // Refuses anything but a mainnet transparent P2PKH address before a zatoshi moves.
    const depositScript = zcashP2pkhScript(depositAddress);

    // The relay derives the receiving hub wallet from the owner rather than taking `to`, so `to` is an
    // assertion: a mismatch means the identity encoding drifted from the relay's.
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[ZcashSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    if ('raw' in params && params.raw) {
      return {
        from: srcAddress,
        to: depositAddress,
        value: amount,
        data: payloadHash,
        token,
      } satisfies ZcashRawTransaction as TxReturnType<ZcashChainKey, R>;
    }

    const { walletProvider } = params;
    let txid: string;
    if (walletProvider.signTransaction) {
      const signTransaction = walletProvider.signTransaction.bind(walletProvider);
      txid = await this.buildSignAndBroadcast(srcAddress, amount, depositScript, depositAddress, signTransaction);
      this.depositOutputs.set(txid, DEPOSIT_OUTPUT_INDEX);
    } else if (walletProvider.sendTransfer) {
      txid = canonicalTxid(await walletProvider.sendTransfer({ to: depositAddress, amount }));
    } else {
      throw new Error(
        '[ZcashSpokeService.deposit] wallet provider implements neither signTransaction nor sendTransfer',
      );
    }

    const submitted = await this.submitDeposit(txid);
    if (!submitted.ok) {
      this.config.logger.warn('[ZcashSpokeService.deposit] relay notify failed; settle or submitMpcDeposit re-notifies it', {
        txid,
        error: submitted.error,
      });
    }

    if (!this.depositOutputs.has(txid)) {
      // The wallet chose the output order; the relay keys the deposit on the index that pays the deposit address.
      const index = await this.findDepositOutput(txid, depositScript, amount);
      if (index !== undefined) this.depositOutputs.set(txid, index);
    }

    return txid satisfies string as TxReturnType<ZcashChainKey, R>;
  }

  /**
   * Notify the relay of a broadcast deposit, without waiting for the hub mint. The funds are already on chain,
   * so it retries, and a failure keeps the txid: the only handle left for re-notifying the deposit.
   */
  public async submitDeposit(txHash: string): Promise<Result<void>> {
    const txid = canonicalTxid(txHash);
    try {
      await this.retryNotify(() => notify(this.relayApiUrl, this.chainId, txid));
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: new Error(`mpc-relay: deposit ${txid} was not notified — re-notify this txid to settle it`, {
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

  /** Select UTXOs, build the deposit transaction, have the wallet sign it, check the signed bytes, broadcast. */
  private async buildSignAndBroadcast(
    srcAddress: string,
    amount: bigint,
    depositScript: string,
    depositAddress: string,
    signTransaction: (tx: ZcashUnsignedTransaction) => Promise<string>,
  ): Promise<string> {
    const [chainInfo, rawUtxos] = await Promise.all([
      this.rpc<{ consensus: { nextblock: string } }>('getblockchaininfo', []),
      this.rpc<RpcUtxo[]>('getaddressutxos', [{ addresses: [srcAddress] }]),
    ]);
    const changeScript = zcashP2pkhScript(srcAddress);
    const utxos = rawUtxos.map(u => ({
      txid: u.txid,
      vout: u.outputIndex,
      value: BigInt(u.satoshis),
      scriptPubKey: u.script || changeScript,
    }));
    const { inputs, change } = this.selectInputs(utxos, amount);

    const unsigned: ZcashUnsignedTransaction = {
      consensusBranchId: Number.parseInt(chainInfo.consensus.nextblock, 16) >>> 0,
      lockTime: 0,
      expiryHeight: 0,
      inputs,
      outputs: [
        { value: amount, scriptPubKey: depositScript },
        ...(change > 0n ? [{ value: change, scriptPubKey: changeScript }] : []),
      ],
    };
    const signedHex = await signTransaction(unsigned);

    // Check the bytes that will be broadcast, not the transaction that was requested: a wallet that pays the
    // wrong script or amount would lose funds, and a bad signature is caught by the node anyway.
    const outputs = parseZcashV5Outputs(signedHex);
    const deposit = outputs[DEPOSIT_OUTPUT_INDEX];
    if (!deposit || deposit.scriptPubKey !== depositScript || deposit.value !== amount) {
      throw new Error(
        `[ZcashSpokeService.deposit] signed transaction does not pay exactly ${amount} to ${depositAddress}`,
      );
    }
    if (outputs.slice(1).some(o => o.scriptPubKey !== changeScript)) {
      throw new Error('[ZcashSpokeService.deposit] signed transaction pays an unexpected output');
    }

    return canonicalTxid(await this.rpc<string>('sendrawtransaction', [signedHex]));
  }

  /** The verbose transaction, or `undefined` while the node has not seen it yet. */
  private async getTransaction(txid: string): Promise<ZcashRawTransactionReceipt | undefined> {
    try {
      return await this.rpc<ZcashRawTransactionReceipt>('getrawtransaction', [txid, 1]);
    } catch (error) {
      this.config.logger.debug('[ZcashSpokeService] transaction not available yet', { txid, error });
      return undefined;
    }
  }

  /**
   * The index of the output paying exactly `amount` to `depositScript`, waiting briefly for the node to see a
   * transaction the wallet broadcast elsewhere. `undefined` if it never shows up; throws if it shows up paying
   * something else, since the relay would then mint nothing.
   */
  private async findDepositOutput(txid: string, depositScript: string, amount: bigint): Promise<number | undefined> {
    for (let attempt = 0; attempt < OUTPUT_LOOKUP_ATTEMPTS; attempt++) {
      const tx = await this.getTransaction(txid);
      if (tx?.vout) {
        const output = tx.vout.find(
          o => o.scriptPubKey?.hex === depositScript && o.valueZat !== undefined && BigInt(o.valueZat) === amount,
        );
        if (!output) {
          throw new Error(
            `[ZcashSpokeService.deposit] transaction ${txid} does not pay exactly ${amount} to the deposit address`,
          );
        }
        return output.n;
      }
      await new Promise(r => setTimeout(r, OUTPUT_LOOKUP_INTERVAL_MS));
    }
    return undefined;
  }

  /**
   * Wait for the hub mint to land for a Zcash deposit, via the MPC relay's deposit record.
   * `txHash` is the txid returned by {@link deposit}.
   */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    const txid = canonicalTxid(txHash);
    // The relay waits for a confirmation and never re-checks a notification that arrived first.
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, txid);
    }, RENOTIFY_INTERVAL_MS);

    const options = {
      timeout: Math.max(timeout ?? 0, ZCASH_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    };
    try {
      const index = this.depositOutputs.get(txid);
      if (index !== undefined) {
        return await waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, txid, index), options);
      }
      return await this.waitForAnyOutput(txid, options.timeout, options.pollIntervalMs);
    } finally {
      clearInterval(renotify);
    }
  }

  /**
   * Wait for a deposit whose output index is unknown — one a wallet built, or one made before a reload — by
   * polling the relay record of every output of the transaction until one settles.
   */
  private async waitForAnyOutput(
    txid: string,
    timeout: number,
    pollIntervalMs: number,
  ): Promise<Result<DepositRecord>> {
    const deadline = Date.now() + timeout;
    let indices: number[] | undefined;
    for (;;) {
      if (!indices) {
        const outputs = (await this.getTransaction(txid))?.vout;
        indices = outputs?.map(o => o.n);
      }
      for (const index of indices ?? []) {
        const res = await getDeposit(this.relayApiUrl, toDepositId(this.chainId, txid, index));
        if (res.ok && (res.value.status === 'minted' || res.value.status === 'swept')) {
          this.depositOutputs.set(txid, index);
          return res;
        }
      }
      if (Date.now() >= deadline) {
        return { ok: false, error: new Error(`mpc-relay: timed out waiting for deposit ${txid}`) };
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
  }

  /**
   * The MPC relay's current record for a Zcash deposit, read once. The relay keys a deposit on the output paying
   * the deposit address: when this instance did not make the deposit, every output of the transaction is read and
   * a settled record is preferred.
   */
  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    const txid = canonicalTxid(txHash);
    try {
      const known = this.depositOutputs.get(txid);
      if (known !== undefined) return await getDeposit(this.relayApiUrl, toDepositId(this.chainId, txid, known));

      const indices = (await this.getTransaction(txid))?.vout?.map(o => o.n) ?? [];
      let found: Result<DepositRecord> | undefined;
      let failure: Result<DepositRecord> | undefined;
      for (const index of indices) {
        const res = await getDeposit(this.relayApiUrl, toDepositId(this.chainId, txid, index));
        if (!res.ok) {
          failure = res;
        } else if (res.value.status === 'minted' || res.value.status === 'swept') {
          return res;
        } else {
          found ??= res;
        }
      }
      return found ?? failure ?? { ok: false, error: new Error(`mpc-relay: no deposit record for ${txid}`) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Transparent ZEC balance of the deposit owner, in zatoshis. */
  public async getDeposit(params: GetDepositParams<ZcashChainKey>): Promise<bigint> {
    const res = await this.rpc<{ balance: number | string }>('getaddressbalance', [{ addresses: [params.srcAddress] }]);
    return BigInt(res.balance);
  }

  /** The user's own wallet balance of `token`, in zatoshis — the same read as {@link getDeposit}. */
  public async getWalletBalance(params: GetBalanceParams<ZcashChainKey>): Promise<bigint> {
    return this.getDeposit({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      token: params.token.address,
    });
  }

  /** The user's own wallet balances of multiple tokens, keyed by `token.address`. */
  public async getWalletBalances(params: GetBalancesParams<ZcashChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  /** The ZIP-317 fee of a typical deposit — one input, a deposit output and change — in zatoshis. */
  public async estimateGas(_params: EstimateGasParams<ZcashChainKey>): Promise<ZcashGasEstimate> {
    return { fee: zcashZip317Fee(1, 2) };
  }

  /**
   * Withdraw / borrow (hub→Zcash) via the MPC relay's signature-mode pipeline.
   *
   * The `payload` is the hub-wallet calls to run; `dstAddress` is the hub wallet that executes them. The
   * account signs the withdraw-auth hash with `signmessage` (scheme 6), and the relay verifies → burns on the
   * hub → MPC-signs the release. Resolves to the `trackingId` to poll {@link waitForWithdrawal} with. Raw mode
   * is not supported — there is no spoke tx to return.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<ZcashChainKey, Raw>,
  ): Promise<TxReturnType<ZcashChainKey, Raw>> {
    if ('raw' in params && params.raw) {
      throw new Error('[ZcashSpokeService.sendMessage] raw mode is not supported for Zcash withdrawals');
    }

    const message = {
      to: params.dstAddress as Hex, // hub wallet that executes the calls
      data: params.payload,
      nonce: randomWithdrawNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender: zcashIdentityBytes(params.srcAddress),
    };

    const signature = await params.walletProvider.signMessage(computeSignedMessageHash(message));

    const res = await submitWithdraw(this.relayApiUrl, {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature,
      scheme: getMpcRelayChainInfo(ChainKeys.ZCASH_MAINNET).withdrawScheme,
    });
    if (!res.ok) throw res.error;

    return res.value.trackingId satisfies string as TxReturnType<ZcashChainKey, Raw>;
  }

  /** The MPC relay's current record for a withdraw-auth, read once. `trackingId` is what {@link sendMessage} returned. */
  public async getWithdrawalRecord(trackingId: string): Promise<Result<WithdrawalRecord>> {
    return getWithdrawal(this.relayApiUrl, trackingId);
  }

  /**
   * Wait for a hub→Zcash withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(
    trackingId: string,
    timeout?: number,
    until?: WithdrawalSettledOn,
  ): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      until,
      timeout: Math.max(timeout ?? 0, ZCASH_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /**
   * Notify the relay of a hub tx releasing to Zcash, without waiting for the release. The relay has no hub
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
        timeout: Math.max(timeout ?? 0, ZCASH_SETTLEMENT_FLOOR_MS),
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

  /** Poll until the transaction has a confirmation. */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<ZcashChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<ZcashChainKey>>> {
    const txid = canonicalTxid(params.txHash);
    const pollingIntervalMs = params.pollingIntervalMs ?? this.chainConfig.pollingConfig.pollingIntervalMs;
    const maxTimeoutMs = params.maxTimeoutMs ?? this.chainConfig.pollingConfig.maxTimeoutMs;
    const maxAttempts = Math.max(1, Math.round(maxTimeoutMs / pollingIntervalMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const receipt = await this.rpc<ZcashRawTransactionReceipt>('getrawtransaction', [txid, 1]);
        if ((receipt.confirmations ?? 0) > 0) return { ok: true, value: { status: 'success', receipt } };
      } catch (error) {
        // Not yet known to the node is expected right after broadcast.
        this.config.logger.debug('[ZcashSpokeService.waitForTransactionReceipt] poll error', { error });
      }
      await new Promise(r => setTimeout(r, pollingIntervalMs));
    }
    return { ok: true, value: { status: 'timeout', error: new Error(`zcash tx ${txid} not confirmed in time`) } };
  }
}
