import { bytesToBigInt, isHex, sha256, type Hex } from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  type Result,
  type TronChainKey,
  type TronGasEstimate,
  type TronRawTransaction,
  type TronRawTransactionReceipt,
  type TronSpokeChainConfig,
  type TronUnsignedTransaction,
  type TxReturnType,
  type ITronWalletProvider,
} from '@sodax/types';
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
  getDepositAddress,
  notify,
  submitWithdraw,
  toDepositId,
  waitForDeposit,
  waitForWithdrawal,
  type DepositRecord,
  type WithdrawalRecord,
} from '../mpcRelay/MpcRelayApiService.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';
import {
  assembleBroadcastHex,
  computeSignedMessageHash,
  encodeTrc20TransferParams,
  spliceMemo,
  tronAddressToWord,
  tronBase58ToHex,
  tronIdentityBytes,
} from './tron-utils.js';

/**
 * Energy cap for a TRC-20 deposit, in SUN. Bounds the TRX burned when the sender has no staked
 * energy; it is a cap, not a spend. 100 TRX covers the expensive case (~65 TRX).
 */
const TRC20_DEPOSIT_FEE_LIMIT_SUN = 100_000_000;

/** The decoded transaction body TronGrid returns beside `raw_data_hex`. */
type TronRawData = Record<string, unknown>;

/** A built transfer: the hex body the memo is spliced into, plus the node's decoded form. */
type BuiltTransfer = { rawDataHex: string; rawData?: TronRawData };

/** Per-request budget for a TronGrid call, mirroring the intent relay's own request cap. */
const TRON_RPC_TIMEOUT_MS = 15_000;

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout: confirmations,
 * aggregation, the NEAR submit and the hub tx outlast the generic cross-chain timeout.
 */
const TRON_SETTLEMENT_FLOOR_MS = 300_000;

/** Re-notify interval while waiting for a deposit — about two Tron blocks. `/notify` is idempotent. */
const RENOTIFY_INTERVAL_MS = 6_000;

/** A 65-byte `r‖s‖v` placeholder — only its length matters when sizing a transaction. */
const SIGNATURE_PLACEHOLDER = '00'.repeat(65);

/** Placeholder memo for sizing: a deposit memo is always exactly 32 bytes. */
const MEMO_PLACEHOLDER = `0x${'00'.repeat(32)}` as Hex;

/**
 * Withdraw-auth nonce: random, since NEAR only rejects a repeat (a clock reading collides or goes
 * backwards). Capped at 53 bits because the relay round-trips it through a JavaScript `number`, and a
 * rounded nonce fails signature recovery after it is already spent.
 */
const MAX_SAFE_NONCE = (1n << 53n) - 1n;

function randomNonce(): bigint {
  return bytesToBigInt(crypto.getRandomValues(new Uint8Array(8))) & MAX_SAFE_NONCE;
}

/**
 * Spoke service for Tron. Deposits ride the MPC relay in memo mode: a transfer to the shared reserve
 * carries a 32-byte payload-hash memo. The service builds and broadcasts it; the wallet only signs.
 *
 * @see MpcRelayApiService for the relay REST flow.
 */
export class TronSpokeService {
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live: `ConfigService` can swap in backend-fetched config after construction.
  private get chainConfig(): TronSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.TRON_MAINNET);
  }

  private get rpcUrl(): string {
    return this.chainConfig.rpcUrl;
  }

  private get relayApiUrl(): TronSpokeChainConfig['mpcRelayApiEndpoint'] {
    return this.chainConfig.mpcRelayApiEndpoint;
  }

  /** The relay's id for this chain, from {@link MpcRelayChainMap} rather than the chain's own config. */
  private get chainId(): string {
    return getMpcRelayChainInfo(ChainKeys.TRON_MAINNET).chainId.toString();
  }

  /**
   * One TronGrid call, bounded by {@link TRON_RPC_TIMEOUT_MS}, covering the body read. No retry here:
   * callers either broadcast, where a silent re-POST is unsafe, or retry at their own call site.
   */
  private async rpc<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRON_RPC_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.rpcUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`tron rpc ${path}: ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`tron rpc ${path}: timed out after ${TRON_RPC_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deposit TRX or a TRC-20 token into the hub via the MPC relay.
   *
   * `Raw: true` returns the unsigned transfer descriptor. `Raw: false` builds, signs and broadcasts the
   * memo transfer, notifies the relay, and resolves to the source tx hash. The memo is a
   * transaction-level field, so a TRC-20 transfer carries it like a value transfer, and needs no allowance.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<TronChainKey, R>,
  ): Promise<TxReturnType<TronChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;
    const isNative = token === this.chainConfig.nativeToken;

    // Register the hub-side calls and get the shared reserve + the memo to tag the transfer with.
    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    const { reserveAddress, memo, hubWallet } = addr.value;
    this.warnOnUnknownReserve(reserveAddress);

    // The relay derives the hub wallet from `srcAddress`, so `to` is an assertion, not an instruction.
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[TronSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    if ('raw' in params && params.raw) {
      return {
        from: srcAddress,
        to: reserveAddress,
        value: amount,
        data: memo,
        token,
      } satisfies TronRawTransaction as TxReturnType<TronChainKey, R>;
    }

    const walletProvider = params.walletProvider;

    // Built here, not in the wallet: an injected TronWeb's own node answers 401 for `createTransaction`.
    const txID = await this.buildSignAndBroadcast(
      walletProvider,
      srcAddress,
      reserveAddress,
      token,
      amount,
      memo,
      isNative,
    );

    // The funds are already on chain, so retry, and keep the tx hash in the error — it is the only
    // handle left for polling or re-notifying the deposit.
    try {
      // `retry` reacts to a throw, and `notify` reports failure in its Result — so rethrow to arm it.
      await retry(async () => {
        const res = await notify(this.relayApiUrl, this.chainId, txID);
        if (!res.ok) throw res.error;
      });
    } catch (error) {
      throw new Error(
        `[TronSpokeService.deposit] deposit ${txID} broadcast but the relay was not notified — re-notify this tx hash to settle it`,
        { cause: error },
      );
    }

    return txID satisfies string as TxReturnType<TronChainKey, R>;
  }

  /** Build the transfer over the node, splice the memo in as protobuf field 10, then sign and broadcast. */
  private async buildSignAndBroadcast(
    walletProvider: ITronWalletProvider,
    srcAddress: string,
    reserveAddress: string,
    token: string,
    amount: bigint,
    memo: Hex,
    isNative: boolean,
  ): Promise<string> {
    const built = isNative
      ? await this.buildNativeTransfer(srcAddress, reserveAddress, amount)
      : await this.buildTrc20Transfer(srcAddress, reserveAddress, token, amount);

    const rawWithMemo = spliceMemo(built.rawDataHex, memo);
    const txID = sha256(`0x${rawWithMemo}`).slice(2);

    const unsigned: TronUnsignedTransaction = {
      txID,
      raw_data_hex: rawWithMemo,
      visible: false,
      ...(built.rawData ? { raw_data: { ...built.rawData, data: memo.replace(/^0x/, '') } } : {}),
    };
    const signed = await walletProvider.signTransaction(unsigned);
    const signature = signed.signature[0];
    if (!signature) throw new Error('[TronSpokeService.deposit] wallet returned no signature');

    // The tx is signed, so a lost or rejected broadcast response does not prove it missed the chain;
    // keep the deterministic txID in the error so the caller can look it up or re-notify it.
    let broadcast: { result?: boolean; message?: string };
    try {
      broadcast = await this.rpc<{ result?: boolean; message?: string }>('/wallet/broadcasthex', {
        transaction: assembleBroadcastHex(rawWithMemo, signature),
      });
    } catch (error) {
      throw new Error(`[TronSpokeService.deposit] broadcast of ${txID} failed or timed out`, { cause: error });
    }
    if (!broadcast.result) {
      throw new Error(`[TronSpokeService.deposit] broadcast of ${txID} failed: ${broadcast.message ?? ''}`);
    }
    return txID;
  }

  /**
   * Warn, but do not block, when the relay's reserve differs from the chain config's. The relay may
   * rotate it legitimately, so pinning would strand deposits; a change is still worth noticing.
   */
  private warnOnUnknownReserve(reserveAddress: string): void {
    const expected = this.chainConfig.addresses.reserve;
    if (reserveAddress !== expected) {
      this.config.logger.warn(
        `[TronSpokeService] MPC relay returned reserve ${reserveAddress}, chain config expects ${expected} — paying the relay's address, but the config may be stale`,
      );
    }
  }

  /** Unsigned native TRX transfer to the reserve: the node's hex body plus its decoded form. */
  private async buildNativeTransfer(from: string, to: string, amount: bigint): Promise<BuiltTransfer> {
    // Hex addresses, not `visible: true`: the wallet compares `owner_address` to its account in hex.
    const created = await this.rpc<{ raw_data_hex?: string; raw_data?: TronRawData; Error?: string }>(
      '/wallet/createtransaction',
      {
        owner_address: tronBase58ToHex(from),
        to_address: tronBase58ToHex(to),
        amount: Number(amount),
      },
    );
    if (!created.raw_data_hex) throw new Error(`[TronSpokeService.deposit] createtransaction failed: ${created.Error}`);
    return { rawDataHex: created.raw_data_hex, rawData: created.raw_data };
  }

  /** Unsigned TRC-20 `transfer(reserve, amount)` on `token`: the node's hex body plus its decoded form. */
  private async buildTrc20Transfer(from: string, to: string, token: string, amount: bigint): Promise<BuiltTransfer> {
    const built = await this.rpc<{
      result?: { result?: boolean; message?: string };
      transaction?: { raw_data_hex?: string; raw_data?: TronRawData };
    }>('/wallet/triggersmartcontract', {
      // Hex addresses for the same reason as the native builder above.
      owner_address: tronBase58ToHex(from),
      contract_address: tronBase58ToHex(token),
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTrc20TransferParams(to, amount),
      fee_limit: TRC20_DEPOSIT_FEE_LIMIT_SUN,
      call_value: 0,
    });

    const rawDataHex = built.transaction?.raw_data_hex;
    if (!rawDataHex) {
      // `message` is hex-encoded ASCII on this endpoint; surface it raw rather than half-decoded.
      throw new Error(
        `[TronSpokeService.deposit] triggersmartcontract failed: ${built.result?.message ?? 'no transaction returned'}`,
      );
    }
    return { rawDataHex, rawData: built.transaction?.raw_data };
  }

  /**
   * Wait for the hub mint to land for a Tron deposit, via the MPC relay's deposit record.
   * `txHash` is the source Tron tx hash returned by {@link deposit}.
   */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    // `/notify` accepts a tx before it is confirmed and never re-checks, so a notification sent right
    // after broadcast can land too early. Re-notifying is idempotent.
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, txHash);
    }, RENOTIFY_INTERVAL_MS);

    try {
      return await waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, txHash), {
        // Never below what the chain physically needs — see TRON_SETTLEMENT_FLOOR_MS.
        timeout: Math.max(timeout ?? 0, TRON_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  /** On-chain balance of `token` for the owner — memo mode has no asset manager to read instead. */
  public async getDeposit(params: GetDepositParams<TronChainKey>): Promise<bigint> {
    if (params.token !== this.chainConfig.nativeToken) {
      const res = await this.rpc<{ constant_result?: string[] }>('/wallet/triggerconstantcontract', {
        owner_address: params.srcAddress,
        contract_address: params.token,
        function_selector: 'balanceOf(address)',
        parameter: tronAddressToWord(params.srcAddress),
        visible: true,
      });
      const word = res.constant_result?.[0];
      return word ? BigInt(`0x${word}`) : 0n;
    }

    const acct = await this.rpc<{ balance?: number }>('/wallet/getaccount', {
      address: tronBase58ToHex(params.srcAddress),
      visible: false,
    });
    return BigInt(acct.balance ?? 0);
  }

  /** The user's own wallet balance of `token`, in smallest units — the same read as {@link getDeposit}. */
  public async getWalletBalance(params: GetBalanceParams<TronChainKey>): Promise<bigint> {
    return this.getDeposit({ srcChainKey: params.srcChainKey, srcAddress: params.srcAddress, token: params.token.address });
  }

  /** The user's own wallet balances of multiple tokens, keyed by `token.address`. */
  public async getWalletBalances(params: GetBalancesParams<TronChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  /**
   * Resource cost of a deposit: energy from a constant call, bandwidth from the assembled transaction's
   * size. Tron charges these to staked resources, so there is no single fee number. TRX uses no energy.
   */
  public async estimateGas(params: EstimateGasParams<TronChainKey>): Promise<TronGasEstimate> {
    const { from, to, value, token, data } = params.tx;
    const isNative = token === this.chainConfig.nativeToken;

    const energy = isNative ? 0n : await this.estimateTrc20Energy(from, to, token, value);

    // Bandwidth is charged on the serialized signed transaction, so size the real one.
    const built = isNative
      ? await this.buildNativeTransfer(from, to, value)
      : await this.buildTrc20Transfer(from, to, token, value);
    const memo = isHex(data) && data.length === MEMO_PLACEHOLDER.length ? data : MEMO_PLACEHOLDER;
    const signed = assembleBroadcastHex(spliceMemo(built.rawDataHex, memo), SIGNATURE_PLACEHOLDER);

    return { energy, bandwidth: BigInt(signed.length / 2) } satisfies TronGasEstimate;
  }

  /** Energy a TRC-20 `transfer` would consume, from a constant (non-broadcasting) call. */
  private async estimateTrc20Energy(from: string, to: string, token: string, amount: bigint): Promise<bigint> {
    const res = await this.rpc<{ energy_used?: number }>('/wallet/triggerconstantcontract', {
      owner_address: from,
      contract_address: token,
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTrc20TransferParams(to, amount),
      visible: true,
    });
    return BigInt(res.energy_used ?? 0);
  }

  /**
   * Withdraw / borrow (hub→Tron) via the MPC relay. `payload` is the hub-wallet calls to run and
   * `dstAddress` the hub wallet that runs them; the account signs the withdraw-auth digest (scheme 1).
   * Resolves to the `trackingId` for {@link waitForWithdrawal}. Raw mode has no spoke tx to return.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<TronChainKey, Raw>,
  ): Promise<TxReturnType<TronChainKey, Raw>> {
    if ('raw' in params && params.raw) {
      throw new Error('[TronSpokeService.sendMessage] raw mode is not supported for Tron withdrawals');
    }

    const sender = tronIdentityBytes(params.srcAddress);
    const message = {
      to: params.dstAddress as Hex, // hub wallet that executes the calls
      data: params.payload,
      nonce: randomNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender,
    };

    const signature = await params.walletProvider.signMessage(computeSignedMessageHash(message));

    const request = {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature,
      scheme: getMpcRelayChainInfo(ChainKeys.TRON_MAINNET).withdrawScheme,
    };
    const res = await submitWithdraw(this.relayApiUrl, request);
    if (!res.ok) throw res.error;

    return res.value.trackingId satisfies string as TxReturnType<TronChainKey, Raw>;
  }

  /**
   * Wait for a hub→Tron withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(trackingId: string, timeout?: number): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      // Never below what the chain physically needs — see TRON_SETTLEMENT_FLOOR_MS.
      timeout: Math.max(timeout ?? 0, TRON_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /** Poll TronGrid until the transaction is included in a block, mapping the receipt to the SDK shape. */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<TronChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<TronChainKey>>> {
    const { txHash } = params;
    const pollingIntervalMs = params.pollingIntervalMs ?? this.chainConfig.pollingConfig.pollingIntervalMs;
    const maxTimeoutMs = params.maxTimeoutMs ?? this.chainConfig.pollingConfig.maxTimeoutMs;
    const value = txHash.replace(/^0x/, '');
    const maxAttempts = Math.max(1, Math.round(maxTimeoutMs / pollingIntervalMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const info = await this.rpc<TronRawTransactionReceipt>('/wallet/gettransactioninfobyid', { value });
        if (info.blockNumber) {
          const reverted = info.receipt?.result && info.receipt.result !== 'SUCCESS';
          if (reverted) {
            return {
              ok: true,
              value: { status: 'failure', error: new Error(`tron tx reverted: ${info.receipt?.result}`) },
            };
          }
          return { ok: true, value: { status: 'success', receipt: info } };
        }
      } catch (error) {
        this.config.logger.debug('[TronSpokeService.waitForTransactionReceipt] poll error', { error });
      }
      await new Promise(r => setTimeout(r, pollingIntervalMs));
    }
    return { ok: true, value: { status: 'timeout', error: new Error(`tron tx ${txHash} not confirmed in time`) } };
  }
}
