import { Address, beginCell, Cell } from '@ton/core';
import type { Hex } from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  type Result,
  type TonChainKey,
  type TonGasEstimate,
  type TonRawTransaction,
  type TonRawTransactionReceipt,
  type TonSpokeChainConfig,
  type TxReturnType,
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
  buildJettonDepositBody,
  buildTonCommentBody,
  normalizeTonAddress,
  parseJettonNotificationMemo,
  parseTonComment,
  tonIdentityBytes,
  tonWalletAddress,
} from './ton-utils.js';

/** Per-request budget for a toncenter call. */
const TON_RPC_TIMEOUT_MS = 15_000;

/** toncenter's keyless tier answers 429 readily; a rate-limited call is retried this many times. */
const TON_RPC_RATE_LIMIT_RETRIES = 5;

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout: the relay still has to
 * attest, submit to NEAR and mint on the hub (and for a withdrawal, MPC-sign the release).
 */
const TON_SETTLEMENT_FLOOR_MS = 300_000;

/** How often to re-notify the relay while waiting for a deposit — roughly one TON block. */
const RENOTIFY_INTERVAL_MS = 6_000;

/** How long a TonConnect transaction stays sendable. */
const TON_VALID_WINDOW_SECS = 300;

/**
 * TON attached to a jetton deposit, and the part of it forwarded with the notification. The forward must
 * be large enough for the reserve's jetton wallet to notify the reserve owner — at 1 nanoton the internal
 * transfer bounces and the jettons come back. Unused TON refunds to the sender. Values from live mainnet
 * deposits.
 */
const JETTON_DEPOSIT_ATTACHED_NANOTON = 200_000_000n;
const JETTON_DEPOSIT_FORWARD_NANOTON = 100_000_000n;

/** How many times, and how often, to look for the reserve transaction a deposit produced. */
const DEPOSIT_TX_POLL_ATTEMPTS = 40;
const DEPOSIT_TX_POLL_INTERVAL_MS = 3_000;

type ToncenterTx = TonRawTransactionReceipt;

/** Bare lowercase hex of a toncenter hash, which toncenter reports as base64. */
function toHexHash(hash: string): string {
  return /^[0-9a-fA-F]{64}$/.test(hash) ? hash.toLowerCase() : Buffer.from(hash, 'base64').toString('hex');
}

/** The 32-byte memo an inbound reserve message carries, in either form toncenter reports it. */
function memoOf(tx: ToncenterTx): string | null {
  const text = tx.in_msg?.msg_data?.text;
  if (text) {
    const raw = Buffer.from(text, 'base64');
    if (raw.length === 32) return `0x${raw.toString('hex')}`;
  }
  const body = tx.in_msg?.msg_data?.body;
  if (!body) return null;
  try {
    const cell = Cell.fromBoc(Buffer.from(body, 'base64'))[0];
    if (!cell) return null;
    return parseJettonNotificationMemo(cell) ?? parseTonComment(cell);
  } catch {
    return null;
  }
}

/**
 * Spoke service for TON. Deposits ride the **MPC relay** in memo mode: native TON carries the 32-byte
 * payload hash as a binary comment, a jetton carries it in the transfer's `forward_payload`.
 *
 * A TON account is addressed in the SDK by its 32-byte ed25519 public key — the relay's identity — and
 * pays from the wallet it controls. Withdrawals use scheme 5, a TonConnect `signData` submitted with the
 * public key and the wallet's signing envelope.
 *
 * @see MpcRelayApiService for the relay REST flow (deposit-address → notify → poll).
 */
export class TonSpokeService implements MpcRelaySettlement {
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live rather than captured in the constructor: `ConfigService` can swap in backend-fetched
  // config after construction.
  private get chainConfig(): TonSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.TON_MAINNET);
  }

  private get relayApiUrl(): TonSpokeChainConfig['mpcRelayApiEndpoint'] {
    return this.chainConfig.mpcRelayApiEndpoint;
  }

  /** The relay's id for this chain (607). */
  private get chainId(): string {
    return getMpcRelayChainInfo(ChainKeys.TON_MAINNET).chainId.toString();
  }

  private isNative(token: string): boolean {
    return token === this.chainConfig.nativeToken;
  }

  /** One toncenter JSON-RPC call, bounded by a timeout and retried on toncenter's rate limit. */
  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TON_RPC_TIMEOUT_MS);
      try {
        const res = await fetch(this.chainConfig.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
          signal: controller.signal,
        });
        if (res.status === 429 && attempt < TON_RPC_RATE_LIMIT_RETRIES) {
          await new Promise(r => setTimeout(r, 1_000 * 2 ** attempt));
          continue;
        }
        if (!res.ok) throw new Error(`toncenter ${method}: ${res.status}`);
        const body = (await res.json()) as { ok?: boolean; result?: T; error?: string };
        if (!body.ok || body.result === undefined) throw new Error(`toncenter ${method}: ${body.error ?? 'no result'}`);
        return body.result;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`toncenter ${method}: timed out after ${TON_RPC_TIMEOUT_MS}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /** `owner`'s jetton wallet for `master`, from the master's `get_wallet_address` get-method. */
  private async jettonWalletOf(master: string, owner: string): Promise<Address> {
    const ownerBoc = beginCell().storeAddress(Address.parse(owner)).endCell().toBoc().toString('base64');
    const result = await this.rpc<{ exit_code?: number; stack?: [string, { bytes?: string } | string][] }>(
      'runGetMethod',
      { address: master, method: 'get_wallet_address', stack: [['tvm.Slice', ownerBoc]] },
    );
    const top = result.stack?.[0];
    const raw = typeof top?.[1] === 'string' ? top[1] : top?.[1]?.bytes;
    if (result.exit_code !== 0 || !raw) {
      throw new Error(`[TonSpokeService] get_wallet_address failed on ${master} (exit ${result.exit_code})`);
    }
    const cell = Cell.fromBoc(Buffer.from(raw, 'base64'))[0];
    if (!cell) throw new Error(`[TonSpokeService] get_wallet_address returned no cell for ${master}`);
    return cell.beginParse().loadAddress();
  }

  /** The reserve's latest logical time, so a deposit poll only accepts transactions newer than the send. */
  private async reserveLatestLt(reserve: string): Promise<bigint> {
    const txs = await this.rpc<ToncenterTx[]>('getTransactions', { address: reserve, limit: 1 });
    return BigInt(txs[0]?.transaction_id.lt ?? '0');
  }

  /**
   * The hash of the reserve transaction carrying `memo`, newer than `sinceLt`. TonConnect does not return
   * a transaction hash, and the relay keys a deposit on the reserve-side transaction, so it is found by
   * memo. The baseline matters: a memo has no per-deposit nonce, so an older deposit can reuse it.
   */
  private async findReserveTx(reserve: string, memo: string, sinceLt: bigint): Promise<Hex> {
    const want = memo.toLowerCase();
    for (let attempt = 0; attempt < DEPOSIT_TX_POLL_ATTEMPTS; attempt++) {
      const txs = await this.rpc<ToncenterTx[]>('getTransactions', { address: reserve, limit: 16 });
      const match = txs.find(
        tx => BigInt(tx.transaction_id.lt) > sinceLt && memoOf(tx)?.toLowerCase() === want && tx.transaction_id.hash,
      );
      if (match) return `0x${toHexHash(match.transaction_id.hash)}`;
      await new Promise(r => setTimeout(r, DEPOSIT_TX_POLL_INTERVAL_MS));
    }
    throw new Error(
      `[TonSpokeService.deposit] deposit with memo ${memo} was sent but not found on the reserve in time`,
    );
  }

  /**
   * Deposit TON or a jetton into the hub via the MPC relay.
   *
   * `srcAddress` is the account's public key. `Raw: true` returns the unsigned message (sent from the
   * key's wallet-v4R2 address). `Raw: false` has the wallet send it from the account it controls, finds the
   * reserve transaction that carries the memo, and notifies the relay — resolving to that transaction hash.
   * Once the deposit has landed, a failed notify warns and still resolves to the hash, so a retry cannot send
   * it twice: `settle` re-notifies it, and a caller that does not settle notifies it with `spoke.submitMpcDeposit`.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<TonChainKey, R>,
  ): Promise<TxReturnType<TonChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;
    const owner = tonIdentityBytes(srcAddress);

    const addr = await getDepositAddress(this.relayApiUrl, owner, this.chainId, data);
    if (!addr.ok) throw addr.error;
    if (addr.value.depositMethod !== 'memo') {
      throw new Error(
        `[TonSpokeService.deposit] relay returned a ${addr.value.depositMethod}-mode deposit, expected memo`,
      );
    }
    const { reserveAddress, memo, hubWallet } = addr.value;
    this.warnOnUnknownReserve(reserveAddress);

    // The relay derives the receiving hub wallet from the owner rather than taking `to`, so `to` is an
    // assertion: a mismatch means the identity encoding drifted from the relay's.
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[TonSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    const isRaw = 'raw' in params && params.raw;
    const sender = isRaw ? tonWalletAddress(srcAddress).toString() : await params.walletProvider.getAccountAddress();
    const reserve = Address.parse(reserveAddress).toString();

    let messageTo: string;
    let value: bigint;
    let body: Cell;
    if (this.isNative(token)) {
      messageTo = reserve;
      value = amount;
      body = buildTonCommentBody(memo);
    } else {
      // A jetton moves by messaging the sender's OWN jetton wallet, which then pays the reserve's.
      messageTo = (await this.jettonWalletOf(token, sender)).toString();
      value = JETTON_DEPOSIT_ATTACHED_NANOTON;
      body = buildJettonDepositBody({
        reserve,
        amount,
        payloadHash: memo,
        responseAddress: sender,
        forwardTon: JETTON_DEPOSIT_FORWARD_NANOTON,
      });
    }
    const payload = body.toBoc().toString('base64');

    if (isRaw) {
      return {
        from: sender,
        to: messageTo,
        value,
        data: payload,
        token,
      } satisfies TonRawTransaction as TxReturnType<TonChainKey, R>;
    }

    // Read the baseline BEFORE sending. Do not fall back to 0 on a failed read: with no per-deposit nonce
    // in the memo, a zero baseline could match an older deposit and leave this one unnotified.
    const sinceLt = await this.reserveLatestLt(reserveAddress);

    await params.walletProvider.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + TON_VALID_WINDOW_SECS,
      messages: [{ address: messageTo, amount: value.toString(), payload }],
    });

    const txHash = await this.findReserveTx(reserveAddress, memo, sinceLt);

    const submitted = await this.submitDeposit(txHash);
    if (!submitted.ok) {
      this.config.logger.warn('[TonSpokeService.deposit] relay notify failed; settle or submitMpcDeposit re-notifies it', {
        txHash,
        error: submitted.error,
      });
    }

    return txHash satisfies string as TxReturnType<TonChainKey, R>;
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

  /** Warn when the relay's reserve differs from the configured one, without blocking — reserves can rotate. */
  private warnOnUnknownReserve(reserveAddress: string): void {
    const expected = this.chainConfig.addresses.reserve;
    if (normalizeTonAddress(reserveAddress) !== normalizeTonAddress(expected)) {
      this.config.logger.warn(
        `[TonSpokeService] MPC relay returned reserve ${reserveAddress}, chain config expects ${expected} — paying the relay's address, but the config may be stale`,
      );
    }
  }

  /**
   * Wait for the hub mint to land for a TON deposit, via the MPC relay's deposit record.
   * `txHash` is the reserve transaction hash returned by {@link deposit}.
   */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    // Re-notifying is idempotent, and recovers a notification that reached the relay before toncenter
    // indexed the transaction.
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, txHash);
    }, RENOTIFY_INTERVAL_MS);

    try {
      return await waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, txHash), {
        timeout: Math.max(timeout ?? 0, TON_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  /** The MPC relay's current record for a TON deposit, read once. `txHash` is as for {@link waitForDeposit}. */
  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toDepositId(this.chainId, txHash));
  }

  /**
   * On-chain balance of `token` for the account's wallet-v4R2 address — nanotons for native TON, jetton
   * base units for a jetton. TON memo-mode has no spoke asset manager, so this reads the holder directly.
   */
  public async getDeposit(params: GetDepositParams<TonChainKey>): Promise<bigint> {
    const wallet = tonWalletAddress(params.srcAddress).toString();
    if (this.isNative(params.token)) {
      return BigInt(await this.rpc<string>('getAddressBalance', { address: wallet }));
    }
    const jettonWallet = (await this.jettonWalletOf(params.token, wallet)).toString();
    const state = await this.rpc<string>('getAddressState', { address: jettonWallet });
    // A jetton wallet materialises on its first inbound transfer, so a missing one holds nothing.
    if (state !== 'active') return 0n;
    const result = await this.rpc<{ exit_code?: number; stack?: [string, string][] }>('runGetMethod', {
      address: jettonWallet,
      method: 'get_wallet_data',
      stack: [],
    });
    const balance = result.stack?.[0]?.[1];
    if (result.exit_code !== 0 || balance === undefined) {
      throw new Error(`[TonSpokeService.getDeposit] get_wallet_data failed on ${jettonWallet}`);
    }
    return BigInt(balance);
  }

  /** The user's own wallet balance of `token`, in smallest units — the same read as {@link getDeposit}. */
  public async getWalletBalance(params: GetBalanceParams<TonChainKey>): Promise<bigint> {
    return this.getDeposit({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      token: params.token.address,
    });
  }

  /** The user's own wallet balances of multiple tokens, keyed by `token.address`. */
  public async getWalletBalances(params: GetBalancesParams<TonChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  /**
   * TON a deposit attaches to carry its message: the amount itself for native TON aside, a jetton deposit
   * attaches a fixed 0.2 TON (forward + fees), most of which refunds. Network fees are paid on top by the
   * wallet and are not metered here.
   */
  public async estimateGas({ tx }: EstimateGasParams<TonChainKey>): Promise<TonGasEstimate> {
    return { fee: this.isNative(tx.token) ? 0n : JETTON_DEPOSIT_ATTACHED_NANOTON };
  }

  /**
   * Withdraw / borrow (hub→TON) via the MPC relay's signature-mode pipeline.
   *
   * The `payload` is the hub-wallet calls to run; `dstAddress` is the hub wallet that executes them. The
   * account `signData`s the withdraw-auth hash (scheme 5), and the relay verifies → burns on the hub →
   * MPC-signs the release. Resolves to the `trackingId` to poll {@link waitForWithdrawal} with. Raw mode
   * is not supported — there is no spoke tx to return.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<TonChainKey, Raw>,
  ): Promise<TxReturnType<TonChainKey, Raw>> {
    if ('raw' in params && params.raw) {
      throw new Error('[TonSpokeService.sendMessage] raw mode is not supported for TON withdrawals');
    }

    const sender = tonIdentityBytes(params.srcAddress);
    const message = {
      to: params.dstAddress as Hex, // hub wallet that executes the calls
      data: params.payload,
      nonce: randomWithdrawNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender,
    };

    const signed = await params.walletProvider.signMessage(computeSignedMessageHash(message));

    const res = await submitWithdraw(this.relayApiUrl, {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature: signed.signature,
      scheme: getMpcRelayChainInfo(ChainKeys.TON_MAINNET).withdrawScheme,
      // ed25519 cannot recover its signer, so the key rides along; for TON it is also the identity.
      publicKey: sender,
      tonSignData: {
        workchain: signed.workchain,
        addressHash: signed.addressHash,
        domain: signed.domain,
        timestamp: signed.timestamp,
        payloadType: signed.payloadType,
      },
    });
    if (!res.ok) throw res.error;

    return res.value.trackingId satisfies string as TxReturnType<TonChainKey, Raw>;
  }

  /** The MPC relay's current record for a withdraw-auth, read once. `trackingId` is what {@link sendMessage} returned. */
  public async getWithdrawalRecord(trackingId: string): Promise<Result<WithdrawalRecord>> {
    return getWithdrawal(this.relayApiUrl, trackingId);
  }

  /**
   * Wait for a hub→TON withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(
    trackingId: string,
    timeout?: number,
    until?: WithdrawalSettledOn,
  ): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      until,
      timeout: Math.max(timeout ?? 0, TON_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /**
   * Notify the relay of a hub tx releasing to TON, without waiting for the release. The relay has no hub
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
        timeout: Math.max(timeout ?? 0, TON_SETTLEMENT_FLOOR_MS),
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

  /**
   * Wait until a reserve transaction with this hash is indexed. TON transactions are per-account, and the
   * hashes this service returns are the reserve's, so the reserve is where to look.
   */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<TonChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<TonChainKey>>> {
    const want = params.txHash.replace(/^0x/, '').toLowerCase();
    const pollingIntervalMs = params.pollingIntervalMs ?? this.chainConfig.pollingConfig.pollingIntervalMs;
    const maxTimeoutMs = params.maxTimeoutMs ?? this.chainConfig.pollingConfig.maxTimeoutMs;
    const maxAttempts = Math.max(1, Math.round(maxTimeoutMs / pollingIntervalMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const txs = await this.rpc<ToncenterTx[]>('getTransactions', {
          address: this.chainConfig.addresses.reserve,
          limit: 50,
        });
        const receipt = txs.find(tx => toHexHash(tx.transaction_id.hash) === want);
        if (receipt) return { ok: true, value: { status: 'success', receipt } };
      } catch (error) {
        this.config.logger.debug('[TonSpokeService.waitForTransactionReceipt] poll error', { error });
      }
      await new Promise(r => setTimeout(r, pollingIntervalMs));
    }
    return { ok: true, value: { status: 'timeout', error: new Error(`ton tx ${params.txHash} not indexed in time`) } };
  }
}
