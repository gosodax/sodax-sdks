import { bytesToBigInt, isAddress, sha256, type Hex } from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  type Result,
  type TronChainKey,
  type TronDepositReturnType,
  type TronGasEstimate,
  type TronRawData,
  type TronRawTransaction,
  type TronRawTransactionReceipt,
  type TronRawWithdraw,
  type TronSendMessageReturnType,
  type TronSpokeChainConfig,
  type ITronWalletProvider,
} from '@sodax/types';
import type { ConfigService } from '../../config/ConfigService.js';
import { resolveTimeoutMs } from '../../utils/resolveTimeoutMs.js';
import { retry, sleep } from '../../utils/shared-utils.js';
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
  computePayloadHash,
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
import {
  assembleBroadcastHex,
  assertDepositTransfer,
  computeSignedMessageHash,
  encodeTrc20TransferParams,
  readTrc20TransferCall,
  setExpiration,
  spliceMemo,
  tronAddressToWord,
  tronBase58ToHex,
  tronIdentityBytes,
  type Trc20TransferCall,
} from './tron-utils.js';

/**
 * Energy cap for a TRC-20 deposit, in SUN. Bounds the TRX burned when the sender has no staked
 * energy; it is a cap, not a spend. 100 TRX covers the expensive case (~65 TRX).
 */
const TRC20_DEPOSIT_FEE_LIMIT_SUN = 100_000_000;

/** A built transfer: the hex body the memo is spliced into, plus the node's decoded form. */
type BuiltTransfer = { rawDataHex: string; rawData?: TronRawData };

/** Per-request budget for a TronGrid call, mirroring the intent relay's own request cap. */
const TRON_RPC_TIMEOUT_MS = 15_000;

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout: confirmations,
 * aggregation, the NEAR submit and the hub tx outlast the generic cross-chain timeout.
 */
const TRON_SETTLEMENT_FLOOR_MS = 300_000;

/** Re-notify interval while waiting on a deposit or hub release — about two Tron blocks. `/notify` is idempotent. */
const RENOTIFY_INTERVAL_MS = 6_000;

/** A TronGrid call with no definite answer: it timed out, failed in transit, or a gateway returned 5xx. */
class TronRpcUnanswered extends Error {}

/** Tron accepts an expiration up to 24 hours ahead. */
const TRON_MAX_EXPIRATION_MS = 24 * 60 * 60 * 1000;

/** A 65-byte `r‖s‖v` placeholder — only its length matters when sizing a transaction. */
const SIGNATURE_PLACEHOLDER = '00'.repeat(65);

/** A TronGrid constant call's outcome. It answers 200 for a failed call too, and marks a revert with a `message`. */
type ConstantCallResult = { result?: { result?: boolean; message?: string } };

const constantCallFailed = (res: ConstantCallResult): boolean =>
  res.result?.result !== true || res.result.message !== undefined;

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
export class TronSpokeService implements MpcRelaySettlement {
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
    // Parsed before the request, so a bad URL is a definite failure rather than a transport one.
    const url = new URL(`${this.rpcUrl}${path}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRON_RPC_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status >= 500) throw new TronRpcUnanswered(`tron rpc ${path}: ${res.status}`);
      if (!res.ok) throw new Error(`tron rpc ${path}: ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TronRpcUnanswered(`tron rpc ${path}: timed out after ${TRON_RPC_TIMEOUT_MS}ms`);
      }
      // fetch rejects with a TypeError when the request fails in transit.
      if (error instanceof TypeError)
        throw new TronRpcUnanswered(`tron rpc ${path}: ${error.message}`, { cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deposit TRX or a TRC-20 token into the hub via the MPC relay.
   *
   * Both modes build the memo transfer over the node and check it. `Raw: true` returns it unsigned
   * ({@link TronRawTransaction}); `Raw: false` signs and broadcasts it, notifies the relay, and resolves to
   * the source tx hash. After signing, a definite broadcast failure throws; a broadcast with no definite answer, or
   * a failed notify, warns and still resolves to the hash. `settle` re-notifies it; a caller that does not settle
   * notifies it with `spoke.submitMpcDeposit`. The memo is a transaction-level field, so a TRC-20 transfer carries
   * it like a value transfer, and needs no allowance.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<TronChainKey, R>,
  ): Promise<TronDepositReturnType<R>> {
    const { srcAddress, token, amount, data, to } = params;

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

    // Verifiers attest whatever payload the relay stored under the memo, so the memo must commit to our `data`.
    const expectedMemo = computePayloadHash(hubWallet, data);
    if (memo.toLowerCase() !== expectedMemo) {
      throw new Error(
        `[TronSpokeService.deposit] relay memo ${memo} does not commit to this deposit's payload (expected ${expectedMemo})`,
      );
    }

    // Built here, not in the wallet: an injected TronWeb's own node answers 401 for `createTransaction`.
    const unsigned = await this.buildDepositTransaction({ srcAddress, reserveAddress, token, amount, memo });
    if ('raw' in params && params.raw) {
      return unsigned satisfies TronRawTransaction as TronDepositReturnType<R>;
    }

    const txID = await this.signAndBroadcast({ walletProvider: params.walletProvider, unsigned });
    const submitted = await this.submitDeposit(txID);
    if (!submitted.ok) {
      this.config.logger.warn(
        '[TronSpokeService.deposit] relay notify failed; settle or submitMpcDeposit re-notifies it',
        {
          txID,
          error: submitted.error,
        },
      );
    }
    return txID satisfies string as TronDepositReturnType<R>;
  }

  /**
   * Notify the relay of a broadcast deposit, without waiting for it to land. The funds are already on chain,
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

  /** Build the transfer over the node, check it, and splice the memo in as protobuf field 10. */
  private async buildDepositTransaction({
    srcAddress,
    reserveAddress,
    token,
    amount,
    memo,
  }: {
    srcAddress: string;
    reserveAddress: string;
    token: string;
    amount: bigint;
    memo: Hex;
  }): Promise<TronRawTransaction> {
    const isNative = token === this.chainConfig.nativeToken;
    const built = isNative
      ? await this.buildNativeTransfer(srcAddress, reserveAddress, amount)
      : await this.buildTrc20Transfer(srcAddress, reserveAddress, token, amount);
    assertDepositTransfer(built.rawDataHex, {
      owner: srcAddress,
      reserve: reserveAddress,
      amount,
      token: isNative ? undefined : token,
      maxFeeLimitSun: TRC20_DEPOSIT_FEE_LIMIT_SUN,
    });

    if (!built.rawData) {
      throw new Error(
        '[TronSpokeService.deposit] the node returned no decoded raw_data, which a browser wallet signs from',
      );
    }

    const rawWithMemo = spliceMemo(built.rawDataHex, memo);
    return {
      txID: sha256(`0x${rawWithMemo}`).slice(2),
      raw_data_hex: rawWithMemo,
      raw_data: { ...built.rawData, data: memo.replace(/^0x/, '') },
      visible: false,
    };
  }

  /**
   * Move a raw deposit's expiration later, rewriting `raw_data_hex`, `raw_data.expiration` and `txID`
   * together. Call it before signing when signing can take longer than the node's default window
   * (about 60 s); Tron accepts up to 24 hours ahead.
   */
  public extendExpiration({ tx, expiration }: { tx: TronRawTransaction; expiration: number }): TronRawTransaction {
    if (expiration <= tx.raw_data.expiration || expiration > Date.now() + TRON_MAX_EXPIRATION_MS) {
      throw new Error(
        `[TronSpokeService.extendExpiration] expiration ${expiration} must be after the current one and within 24 hours from now`,
      );
    }
    const raw_data_hex = setExpiration({ rawHex: tx.raw_data_hex, expiration });
    return {
      ...tx,
      txID: sha256(`0x${raw_data_hex}`).slice(2),
      raw_data_hex,
      raw_data: { ...tx.raw_data, expiration },
    };
  }

  /** Have the wallet sign a built deposit, then broadcast it. Resolves to its txID. */
  private async signAndBroadcast({
    walletProvider,
    unsigned,
  }: {
    walletProvider: ITronWalletProvider;
    unsigned: TronRawTransaction;
  }): Promise<string> {
    const { txID } = unsigned;
    const { signature } = await walletProvider.signTransaction(unsigned);
    if (signature.length === 0) throw new Error('[TronSpokeService.deposit] wallet returned no signature');

    const transaction = assembleBroadcastHex({ rawHex: unsigned.raw_data_hex, signatures: signature });
    let broadcast: { result?: boolean; code?: string; message?: string };
    try {
      broadcast = await this.rpc<{ result?: boolean; code?: string; message?: string }>('/wallet/broadcasthex', {
        transaction,
      });
    } catch (error) {
      if (!(error instanceof TronRpcUnanswered)) {
        throw new Error(`[TronSpokeService.deposit] broadcast of ${txID} failed`, { cause: error });
      }
      // No answer does not prove the signed tx missed the chain: hand its txID on for settlement to find.
      this.config.logger.warn(`[TronSpokeService.deposit] broadcast of ${txID} got no answer`, { error });
      return txID;
    }
    // The node already holds this signed tx, so it is on its way like an accepted one.
    if (!broadcast.result && (broadcast.code ?? broadcast.message) !== 'DUP_TRANSACTION_ERROR') {
      throw new Error(
        `[TronSpokeService.deposit] broadcast of ${txID} failed: ${broadcast.code ?? broadcast.message ?? ''}`,
      );
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

  /** The MPC relay's current record for a Tron deposit, read once. `txHash` is as for {@link waitForDeposit}. */
  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toDepositId(this.chainId, txHash));
  }

  /** On-chain balance of `token` for the owner — memo mode has no asset manager to read instead. */
  public async getDeposit(params: GetDepositParams<TronChainKey>): Promise<bigint> {
    if (params.token !== this.chainConfig.nativeToken) {
      const res = await this.rpc<ConstantCallResult & { constant_result?: string[] }>(
        '/wallet/triggerconstantcontract',
        {
          owner_address: params.srcAddress,
          contract_address: params.token,
          function_selector: 'balanceOf(address)',
          parameter: tronAddressToWord(params.srcAddress),
          visible: true,
        },
      );
      const word = res.constant_result?.[0];
      if (constantCallFailed(res) || !word || !/^[0-9a-fA-F]{64}$/.test(word)) {
        throw new Error(
          `[TronSpokeService.getDeposit] balanceOf on ${params.token} failed: ${res.result?.message ?? 'no result'}`,
        );
      }
      return BigInt(`0x${word}`);
    }

    const acct = await this.rpc<{ balance?: number }>('/wallet/getaccount', {
      address: tronBase58ToHex(params.srcAddress),
      visible: false,
    });
    return BigInt(acct.balance ?? 0);
  }

  /** The user's own wallet balance of `token`, in smallest units — the same read as {@link getDeposit}. */
  public async getWalletBalance(params: GetBalanceParams<TronChainKey>): Promise<bigint> {
    return this.getDeposit({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      token: params.token.address,
    });
  }

  /** The user's own wallet balances of multiple tokens, keyed by `token.address`. */
  public async getWalletBalances(params: GetBalancesParams<TronChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  /**
   * Resource cost of a raw deposit: energy from a constant call replaying its TRC-20 transfer, bandwidth
   * from its signed size. Tron charges these to staked resources, so there is no single fee number. TRX
   * uses no energy, and a raw withdraw-auth is signed off chain, so it uses neither.
   */
  public async estimateGas(params: EstimateGasParams<TronChainKey>): Promise<TronGasEstimate> {
    const { tx } = params;
    if ('digest' in tx) return { energy: 0n, bandwidth: 0n } satisfies TronGasEstimate;

    const rawHex = tx.raw_data_hex.replace(/^0x/, '');
    const call = readTrc20TransferCall(rawHex);
    const energy = call ? await this.estimateTrc20Energy(call) : 0n;
    const signed = assembleBroadcastHex({ rawHex, signatures: [SIGNATURE_PLACEHOLDER] });
    return { energy, bandwidth: BigInt(signed.length / 2) } satisfies TronGasEstimate;
  }

  /** Energy a TRC-20 `transfer` would consume, from a constant (non-broadcasting) call. */
  private async estimateTrc20Energy({ owner, contract, parameter }: Trc20TransferCall): Promise<bigint> {
    const res = await this.rpc<ConstantCallResult & { energy_used?: number }>('/wallet/triggerconstantcontract', {
      owner_address: owner,
      contract_address: contract,
      function_selector: 'transfer(address,uint256)',
      parameter,
      visible: true,
    });
    // A revert reports only the energy burned up to it, so its `energy_used` is no estimate.
    if (constantCallFailed(res) || typeof res.energy_used !== 'number') {
      throw new Error(
        `[TronSpokeService.estimateGas] transfer simulation on ${contract} failed: ${res.result?.message ?? 'no result'}`,
      );
    }
    return BigInt(res.energy_used);
  }

  /**
   * Withdraw / borrow (hub→Tron) via the MPC relay. `payload` is the hub-wallet calls to run and
   * `dstAddress` the hub wallet that runs them. `Raw: true` returns the unsigned withdraw-auth
   * ({@link TronRawWithdraw}); `Raw: false` has the account sign its digest (scheme 1), submits it, and
   * resolves to the `trackingId` for {@link waitForWithdrawal}.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<TronChainKey, Raw>,
  ): Promise<TronSendMessageReturnType<Raw>> {
    const withdraw = this.buildWithdraw({
      srcAddress: params.srcAddress,
      hubWallet: params.dstAddress,
      payload: params.payload,
    });
    if ('raw' in params && params.raw) {
      return withdraw satisfies TronRawWithdraw as TronSendMessageReturnType<Raw>;
    }

    const signature = await params.walletProvider.signMessage(withdraw.digest);
    const trackingId = await this.submitSignedWithdraw({ withdraw, signature });
    return trackingId satisfies string as TronSendMessageReturnType<Raw>;
  }

  /** Submit a raw withdraw-auth once signed. Resolves to the `trackingId` for {@link waitForWithdrawal}. */
  public async submitSignedWithdraw({
    withdraw,
    signature,
  }: {
    withdraw: TronRawWithdraw;
    signature: Hex;
  }): Promise<string> {
    const { message, digest, scheme } = withdraw;
    // The relay recovers the signer from the message, so a stale digest or a foreign scheme fails there opaquely.
    const expectedScheme = getMpcRelayChainInfo(ChainKeys.TRON_MAINNET).withdrawScheme;
    if (scheme !== expectedScheme) {
      throw new Error(`[TronSpokeService.submitSignedWithdraw] scheme ${scheme} is not Tron's (${expectedScheme})`);
    }
    const expectedDigest = computeSignedMessageHash({
      ...message,
      nonce: BigInt(message.nonce),
      chainId: BigInt(message.chainId),
    });
    if (digest.toLowerCase() !== expectedDigest) {
      throw new Error(
        `[TronSpokeService.submitSignedWithdraw] digest ${digest} does not match the message (${expectedDigest})`,
      );
    }

    const res = await submitWithdraw(this.relayApiUrl, { message, signature, scheme });
    if (!res.ok) throw res.error;
    return res.value.trackingId;
  }

  /** The withdraw-auth for `hubWallet` to run `payload`, and the digest the Tron account signs. */
  private buildWithdraw({
    srcAddress,
    hubWallet,
    payload,
  }: {
    srcAddress: string;
    hubWallet: string;
    payload: Hex;
  }): TronRawWithdraw {
    // `data` is variable-length inside the signed digest's unframed concat, so `to` must be exactly 20 bytes.
    if (!isAddress(hubWallet)) {
      throw new Error(`[TronSpokeService.sendMessage] invalid hub wallet address: ${hubWallet}`);
    }

    const message = {
      to: hubWallet, // hub wallet that executes the calls
      data: payload,
      nonce: randomNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender: tronIdentityBytes(srcAddress),
    };
    return {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      digest: computeSignedMessageHash(message),
      scheme: getMpcRelayChainInfo(ChainKeys.TRON_MAINNET).withdrawScheme,
    };
  }

  /** The MPC relay's current record for a withdraw-auth, read once. `trackingId` is what {@link sendMessage} returned. */
  public async getWithdrawalRecord(trackingId: string): Promise<Result<WithdrawalRecord>> {
    return getWithdrawal(this.relayApiUrl, trackingId);
  }

  /**
   * Wait for a hub→Tron withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(
    trackingId: string,
    timeout?: number,
    until?: WithdrawalSettledOn,
  ): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      until,
      // Never below what the chain physically needs — see TRON_SETTLEMENT_FLOOR_MS.
      timeout: Math.max(timeout ?? 0, TRON_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /**
   * Notify the relay of a hub tx releasing to Tron, without waiting for the release. The relay has no hub
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
        timeout: Math.max(timeout ?? 0, TRON_SETTLEMENT_FLOOR_MS),
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

  /** Poll TronGrid until the transaction is included in a block, mapping the receipt to the SDK shape. */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<TronChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<TronChainKey>>> {
    const { txHash } = params;
    const { pollingConfig } = this.chainConfig;
    const pollingIntervalMs = resolveTimeoutMs(params.pollingIntervalMs, pollingConfig.pollingIntervalMs);
    const maxTimeoutMs = resolveTimeoutMs(params.maxTimeoutMs, pollingConfig.maxTimeoutMs);
    const value = txHash.replace(/^0x/, '');
    // A deadline, so a stalling node overruns maxTimeoutMs by at most one call (TRON_RPC_TIMEOUT_MS).
    const deadline = Date.now() + maxTimeoutMs;

    for (;;) {
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
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(pollingIntervalMs, remainingMs));
    }
    return { ok: true, value: { status: 'timeout', error: new Error(`tron tx ${txHash} not confirmed in time`) } };
  }
}
