import {
  ChainKeys,
  IndeterminateOutcomeError,
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
import { pollUntil } from '../../utils/pollUntil.js';
import { resolveTimeoutMs } from '../../utils/resolveTimeoutMs.js';
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
  relayTimeout,
  submitWithdraw,
  submitFreshWithdrawWithBackoff,
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
  inspectZcashV5Deposit,
  zcashIdentityBytes,
  zcashP2pkhScript,
  zcashZip317Fee,
} from './zcash-utils.js';

const ZCASH_RPC_TIMEOUT_MS = 20_000;

/** Floor over the caller's settlement timeout: a block takes ~75 s, then the relay attests, submits to NEAR, mints and sweeps. */
const ZCASH_SETTLEMENT_FLOOR_MS = 900_000;

/** Relay re-notify interval while waiting for a deposit — well under one Zcash block. */
const RENOTIFY_INTERVAL_MS = 30_000;

/** A transaction the sdk builds places the deposit output first, and the relay keys a deposit on its output index. */
const DEPOSIT_OUTPUT_INDEX = 0;

/** How long to wait for the node to see a transaction a wallet broadcast through its own backend. */
const OUTPUT_LOOKUP_TIMEOUT_MS = 60_000;
const OUTPUT_LOOKUP_INTERVAL_MS = 5_000;
const FALLBACK_OUTPUT_INDICES = [0, 1];

const RPC_INVALID_ADDRESS_OR_KEY = -5;

class ZcashRpcError extends Error {
  constructor(
    method: string,
    readonly rpcError: { code?: number; message?: string },
  ) {
    super(`zcash rpc ${method}: ${rpcError.message ?? rpcError.code}`);
  }
}

type RpcUtxo = { txid: string; outputIndex: number; script: string; satoshis: number | string };

/** A relay txid in the bare lowercase form the verifier keys deposits on. */
const canonicalTxid = (txid: string): string => txid.replace(/^0x/, '').toLowerCase();

/**
 * Zcash (transparent ZEC) spoke: deposits ride the MPC relay in address mode (a v5 tx to a per-payload t-address).
 * Withdrawals use scheme 6: Bitcoin-style `signmessage` over the hex text of the message hash.
 */
export class ZcashSpokeService implements MpcRelaySettlement {
  private readonly config: ConfigService;
  /** Deposit output index by txid, for deposits made through this instance. */
  private readonly depositOutputs = new Map<string, number>();

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live: `ConfigService` can swap in backend-fetched config after construction.
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

  private requireRpcUrl(): string {
    const { rpcUrl } = this.chainConfig;
    if (!rpcUrl) {
      throw new Error(
        '[ZcashSpokeService] no Zcash RPC configured — set chains.zcash.rpcUrl to an endpoint with address indexing (getaddressutxos)',
      );
    }
    return rpcUrl;
  }

  /** Needs an endpoint with address indexing. */
  private async rpc<T>(method: string, params: unknown[], timeoutMs = ZCASH_RPC_TIMEOUT_MS): Promise<T> {
    const rpcUrl = this.requireRpcUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '1.0', id: 'sodax', method, params }),
        signal: controller.signal,
      });
      const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string } | null };
      if (body.error) throw new ZcashRpcError(method, body.error);
      if (!res.ok) throw new Error(`zcash rpc ${method}: ${res.status}`);
      return body.result as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`zcash rpc ${method}: timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Largest UTXOs first until `amount` + ZIP-317 fee is covered; sub-dust change is left to the fee. */
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
   * Deposit transparent ZEC via the MPC relay. A failed notify or output lookup still returns the txid; signed bytes
   * that do not pay exactly the deposit address throw `IndeterminateOutcomeError` carrying the txid.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<ZcashChainKey, R>,
  ): Promise<TxReturnType<ZcashChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;
    if (!('raw' in params && params.raw)) {
      this.requireRpcUrl();
      // A browser wallet pays from its active account, which must be the one the deposit is derived for.
      if ((await params.walletProvider.getWalletAddress()) !== srcAddress) {
        throw new Error('[ZcashSpokeService.deposit] wallet account does not match the source address');
      }
    }

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

    // The relay derives the hub wallet from the owner, so `to` is only an assertion; a mismatch means identity drift.
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
      try {
        this.config.logger.warn('[ZcashSpokeService.deposit] relay notify failed; re-notify to settle', {
          txid,
          error: submitted.error,
        });
      } catch {
        // Logging must not discard the known transaction ID.
      }
    }

    if (!this.depositOutputs.has(txid)) {
      // The wallet chose the output order; the relay keys the deposit on the index that pays the deposit address.
      const index = await this.findDepositOutput(txid, depositScript, amount).catch(error => {
        try {
          this.config.logger.warn('[ZcashSpokeService.deposit] could not determine the deposit output', {
            txid,
            error,
          });
        } catch {
          // Logging must not discard the known transaction ID.
        }
        return undefined;
      });
      if (index === null) {
        // The wallet has already paid: surface the txid as a recovery handle so callers never pay twice.
        throw new IndeterminateOutcomeError(
          `[ZcashSpokeService.deposit] transaction ${txid} does not pay exactly ${amount} to the deposit address`,
          { cause: undefined, txHash: txid },
        );
      }
      if (index !== undefined) this.depositOutputs.set(txid, index);
    }

    return txid satisfies string as TxReturnType<ZcashChainKey, R>;
  }

  /** Notify the relay of a broadcast deposit with retries; a failure keeps the txid, the only handle to re-notify. */
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

  /** `retry` reacts to a throw while `notify` reports failure in its Result, so rethrow it. */
  private async retryNotify(send: () => Promise<Result<NotifyResponse>>): Promise<void> {
    await retry(async () => {
      const res = await send();
      if (!res.ok) throw res.error;
    });
  }

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

    // Check the bytes to be broadcast, not the requested tx: a wallet paying the wrong script or amount would lose funds.
    const { outputs, txid } = inspectZcashV5Deposit(signedHex);
    const deposit = outputs[DEPOSIT_OUTPUT_INDEX];
    if (!deposit || deposit.scriptPubKey !== depositScript || deposit.value !== amount) {
      throw new Error(
        `[ZcashSpokeService.deposit] signed transaction does not pay exactly ${amount} to ${depositAddress}`,
      );
    }
    if (
      outputs.length !== unsigned.outputs.length ||
      (change > 0n && (outputs[1]?.scriptPubKey !== changeScript || outputs[1].value !== change))
    ) {
      throw new Error('[ZcashSpokeService.deposit] signed transaction pays an unexpected output');
    }

    try {
      const broadcast = await this.rpc<unknown>('sendrawtransaction', [signedHex]);
      if (typeof broadcast === 'string' && canonicalTxid(broadcast) === txid) return txid;
      throw new Error('[ZcashSpokeService.deposit] broadcast did not report the signed transaction ID');
    } catch (cause) {
      // RPC_DESERIALIZATION_ERROR means the node could not accept the submitted bytes.
      if (cause instanceof ZcashRpcError && cause.rpcError.code === -22) throw cause;
      this.depositOutputs.set(txid, DEPOSIT_OUTPUT_INDEX);
      await this.submitDeposit(txid);
      throw new IndeterminateOutcomeError('[ZcashSpokeService.deposit] broadcast was not confirmed', {
        cause,
        txHash: txid,
      });
    }
  }

  /** The verbose transaction, or `undefined` while the node has not seen it yet. */
  private async getTransaction(txid: string, timeoutMs?: number): Promise<ZcashRawTransactionReceipt | undefined> {
    try {
      return await this.rpc<ZcashRawTransactionReceipt>('getrawtransaction', [txid, 1], timeoutMs);
    } catch (error) {
      if (error instanceof ZcashRpcError && error.rpcError.code === RPC_INVALID_ADDRESS_OR_KEY) return undefined;
      throw error;
    }
  }

  /** `null` if the fetched transaction pays a different script or amount. */
  private async findDepositOutput(txid: string, depositScript: string, amount: bigint): Promise<number | null> {
    const index = await pollUntil(
      async remainingMs => {
        const tx = await this.getTransaction(txid, Math.min(ZCASH_RPC_TIMEOUT_MS, remainingMs));
        if (!tx?.vout) return undefined;
        const output = tx.vout.find(
          o => o.scriptPubKey?.hex === depositScript && o.valueZat !== undefined && BigInt(o.valueZat) === amount,
        );
        return output?.n ?? null;
      },
      { timeoutMs: OUTPUT_LOOKUP_TIMEOUT_MS, intervalMs: OUTPUT_LOOKUP_INTERVAL_MS },
    );
    if (index === undefined) throw new Error('Timed out looking up the Zcash deposit output');
    return index;
  }

  private async getOutputIndices(txid: string, timeoutMs?: number): Promise<number[] | undefined> {
    try {
      const tx = await this.getTransaction(txid, timeoutMs);
      return tx?.vout?.map(o => o.n);
    } catch (error) {
      this.config.logger.debug('[ZcashSpokeService] could not read transaction outputs', { txid, error });
      return undefined;
    }
  }

  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    const txid = canonicalTxid(txHash);
    // The relay waits for a confirmation and never re-checks a notification that arrived first.
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, txid);
    }, RENOTIFY_INTERVAL_MS);

    const options = {
      timeout: Math.max(resolveTimeoutMs(timeout, 0), ZCASH_SETTLEMENT_FLOOR_MS),
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

  /** Polls the relay for every output of a deposit with unknown output index (indices 0 and 1 while the node cannot read it). */
  private async waitForAnyOutput(
    txid: string,
    timeout: number,
    pollIntervalMs: number,
  ): Promise<Result<DepositRecord>> {
    let indices: number[] | undefined;
    const settled = await pollUntil(
      async remainingMs => {
        indices ??= await this.getOutputIndices(txid, Math.min(ZCASH_RPC_TIMEOUT_MS, remainingMs));
        for (const index of indices ?? FALLBACK_OUTPUT_INDICES) {
          const res = await getDeposit(this.relayApiUrl, toDepositId(this.chainId, txid, index));
          if (
            res.ok &&
            (res.value.status === 'minted' || res.value.status === 'swept') &&
            res.value.txs?.hubMint?.hash
          ) {
            this.depositOutputs.set(txid, index);
            return res;
          }
        }
        return undefined;
      },
      { timeoutMs: timeout, intervalMs: resolveTimeoutMs(pollIntervalMs, OUTPUT_LOOKUP_INTERVAL_MS) },
    );
    return settled ?? { ok: false, error: relayTimeout(`mpc-relay: timed out waiting for deposit ${txid}`) };
  }

  /** Read once; when this instance did not make the deposit, every output is read and a settled record is preferred. */
  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    const txid = canonicalTxid(txHash);
    try {
      const known = this.depositOutputs.get(txid);
      if (known !== undefined) return await getDeposit(this.relayApiUrl, toDepositId(this.chainId, txid, known));

      const indices = (await this.getOutputIndices(txid)) ?? FALLBACK_OUTPUT_INDICES;
      let found: Result<DepositRecord> | undefined;
      let failure: Result<DepositRecord> | undefined;
      for (const index of indices) {
        const res = await getDeposit(this.relayApiUrl, toDepositId(this.chainId, txid, index));
        if (!res.ok) {
          failure = res;
        } else if ((res.value.status === 'minted' || res.value.status === 'swept') && res.value.txs?.hubMint?.hash) {
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

  /** In zatoshis. */
  public async getDeposit(params: GetDepositParams<ZcashChainKey>): Promise<bigint> {
    const res = await this.rpc<{ balance: number | string }>('getaddressbalance', [{ addresses: [params.srcAddress] }]);
    return BigInt(res.balance);
  }

  public async getWalletBalance(params: GetBalanceParams<ZcashChainKey>): Promise<bigint> {
    return this.getDeposit({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      token: params.token.address,
    });
  }

  /** Keyed by `token.address`. */
  public async getWalletBalances(params: GetBalancesParams<ZcashChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  /** ZIP-317 fee (zatoshis) of a typical deposit: one input, a deposit output and change. */
  public async estimateGas(_params: EstimateGasParams<ZcashChainKey>): Promise<ZcashGasEstimate> {
    return { fee: zcashZip317Fee(1, 2) };
  }

  /** Withdraw / borrow (hub→Zcash) via the MPC relay (scheme 6 `signmessage`); resolves to the `trackingId`. Raw mode is unsupported. */
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

    const request = {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature,
      scheme: getMpcRelayChainInfo(ChainKeys.ZCASH_MAINNET).withdrawScheme,
    };
    const trackingId = await submitFreshWithdrawWithBackoff(async () => {
      const res = await submitWithdraw(this.relayApiUrl, request);
      if (!res.ok) throw res.error;
      return res.value.trackingId;
    });

    return trackingId satisfies string as TxReturnType<ZcashChainKey, Raw>;
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
      timeout: Math.max(resolveTimeoutMs(timeout, 0), ZCASH_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /** Notify the relay of a hub tx releasing to Zcash; it has no hub watcher and learns of it only through `/notify`. */
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
        timeout: Math.max(resolveTimeoutMs(timeout, 0), ZCASH_SETTLEMENT_FLOOR_MS),
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
    params: WaitForTxReceiptParams<ZcashChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<ZcashChainKey>>> {
    const txid = canonicalTxid(params.txHash);
    const polling = this.chainConfig.pollingConfig;
    const receipt = await pollUntil(
      async remainingMs => {
        try {
          const tx = await this.getTransaction(txid, Math.min(ZCASH_RPC_TIMEOUT_MS, remainingMs));
          return tx && (tx.confirmations ?? 0) > 0 ? tx : undefined;
        } catch (error) {
          this.config.logger.debug('[ZcashSpokeService.waitForTransactionReceipt] poll error', { error });
          return undefined;
        }
      },
      {
        timeoutMs: resolveTimeoutMs(params.maxTimeoutMs, polling.maxTimeoutMs),
        intervalMs: resolveTimeoutMs(params.pollingIntervalMs, polling.pollingIntervalMs),
      },
    );
    if (receipt) return { ok: true, value: { status: 'success', receipt } };
    return { ok: true, value: { status: 'timeout', error: new Error(`zcash tx ${txid} not confirmed in time`) } };
  }
}
