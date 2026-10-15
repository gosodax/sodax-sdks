import type { Hex } from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  type Result,
  type TxReturnType,
  type XrpChainKey,
  type XrpRawTransaction,
  type XrpRawTransactionReceipt,
  type XrpSpokeChainConfig,
  type XrpGasEstimate,
  type XrpUnsignedTransaction,
} from '@sodax/types';
import type { ConfigService } from '../../config/ConfigService.js';
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
  getDepositAddress,
  notify,
  submitWithdraw,
  toDepositId,
  waitForDeposit,
  waitForWithdrawal,
  type DepositRecord,
  type WithdrawalRecord,
} from '../mpcRelay/MpcRelayApiService.js';
import { computeSignedMessageHash, randomWithdrawNonce } from './mpc-message.js';
import { xrpCurrencyCode, xrpIdentityBytes } from './xrp-utils.js';

/** Per-request budget for a rippled call, mirroring the Tron service's own request cap. */
const XRP_RPC_TIMEOUT_MS = 15_000;

/**
 * Floor for an MPC-relay settlement wait, applied over the caller's own timeout.
 *
 * XRPL is fast, but aggregation, the NEAR submit and the hub tx still have to clear (and for a
 * withdrawal, the MPC-signed release), so the generic cross-chain timeout would give up mid-flight.
 */
const XRP_SETTLEMENT_FLOOR_MS = 300_000;

/** How often to re-notify the relay while waiting for a deposit — a couple of ledger closes. */
const RENOTIFY_INTERVAL_MS = 6_000;

/**
 * Whether an XRPL account can receive a release, and if not, why. The relay treats a destination it
 * cannot pay as a TERMINAL failure — the funds are already burned on the hub by then — so a caller
 * must check this before withdrawing or borrowing to an XRPL address.
 */
export type XrpDestinationReadiness =
  | { ready: true }
  | { ready: false; reason: 'account_not_found' | 'no_trustline' | 'trustline_limit' };

/**
 * Spoke service for the XRP Ledger. Like Tron, XRPL deposits ride the **MPC relay** in memo mode: a
 * Payment to the shared reserve carries a 32-byte payload-hash memo that the NEAR chain-signatures
 * relay verifies before minting on the hub.
 *
 * Withdrawals use auth scheme 3, which differs from Tron's scheme 1 in two ways:
 *   - the signature is a RAW ed25519 signature over the message hash — no prefix, no envelope;
 *   - ed25519 cannot recover its signer, so the 33-byte `0xED`-prefixed public key is submitted
 *     alongside and the contract derives the AccountID from it to check against `sender`.
 *
 * @see MpcRelayApiService for the relay REST flow (deposit-address → notify → poll).
 */
export class XrpSpokeService {
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live rather than captured in the constructor: `ConfigService` can swap in backend-fetched
  // config after construction, and an address pinned at startup (notably the reserve) would then be
  // stale for the lifetime of the Sodax instance.
  private get chainConfig(): XrpSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.XRP_MAINNET);
  }

  private get rpcUrl(): string {
    return this.chainConfig.rpcUrl;
  }

  private get relayApiUrl(): XrpSpokeChainConfig['mpcRelayApiEndpoint'] {
    return this.chainConfig.mpcRelayApiEndpoint;
  }

  /** The relay's id for this chain, from {@link MpcRelayChainMap} rather than the chain's own config. */
  private get chainId(): string {
    return getMpcRelayChainInfo(ChainKeys.XRP_MAINNET).chainId.toString();
  }

  /**
   * One rippled JSON-RPC call, bounded by {@link XRP_RPC_TIMEOUT_MS}. The signal covers the body
   * read too — a node can answer headers and then stall the stream, which would otherwise hang a
   * polling loop with no upper bound.
   */
  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), XRP_RPC_TIMEOUT_MS);
    try {
      const res = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params: [params] }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`xrpl rpc ${method}: ${res.status}`);
      const body = (await res.json()) as { result?: T & { error?: string; error_message?: string } };
      if (!body.result) throw new Error(`xrpl rpc ${method}: no result`);
      if (body.result.error) {
        throw new Error(`xrpl rpc ${method}: ${body.result.error} ${body.result.error_message ?? ''}`.trim());
      }
      return body.result as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`xrpl rpc ${method}: timed out after ${XRP_RPC_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deposit XRP or an issued currency (IOU) into the hub via the MPC relay.
   *
   * `Raw: true` returns the unsigned transfer descriptor (no wallet needed). `Raw: false` registers
   * the hub `data`, builds the memo Payment, signs it with the wallet provider, submits it, and
   * notifies the relay — resolving to the source tx hash once accepted.
   *
   * Both token kinds ride the same memo mechanism: `Memos` is a transaction-level field, so it
   * rides an IOU Payment exactly as it rides a drops transfer. An IOU deposit needs no allowance,
   * but the RESERVE must already hold a trustline for that currency or the Payment fails on ledger.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<XrpChainKey, R>,
  ): Promise<TxReturnType<XrpChainKey, R>> {
    const { srcAddress, token, amount, data, to } = params;
    const isNative = token === this.chainConfig.nativeToken;

    // Register the hub-side calls and get the shared reserve + the memo to tag the Payment with.
    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    if (addr.value.depositMethod !== 'memo') {
      throw new Error(
        `[XrpSpokeService.deposit] relay returned a ${addr.value.depositMethod}-mode deposit, expected memo`,
      );
    }
    const { reserveAddress, memo, hubWallet } = addr.value;
    this.warnOnUnknownReserve(reserveAddress);

    // The relay derives the receiving hub wallet from `srcAddress` rather than taking `to`, so `to`
    // is an assertion here, not an instruction: if the two disagree the mint lands somewhere the
    // caller is not expecting (a mismatch means the identity encoding drifted from the relay's).
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[XrpSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    if ('raw' in params && params.raw) {
      return {
        from: srcAddress,
        to: reserveAddress,
        value: amount,
        data: memo,
        token,
      } satisfies XrpRawTransaction as TxReturnType<XrpChainKey, R>;
    }

    const walletProvider = params.walletProvider;

    const unsigned: XrpUnsignedTransaction = {
      TransactionType: 'Payment',
      Account: srcAddress,
      Destination: reserveAddress,
      Amount: isNative ? amount.toString() : this.iouAmount(token, amount),
      // MemoData is plain hex without `0x` — this is what the relay matches the deposit on.
      Memos: [{ Memo: { MemoData: memo.replace(/^0x/, '').toUpperCase() } }],
    };

    // Sequence/Fee/LastLedgerSequence are deliberately left to the wallet: GemWallet autofills and
    // rejects a transaction that pins them, and a raw-key provider has xrpl.js do the same. Filling
    // them here would mean racing the wallet for the account's Sequence.
    const signed = await walletProvider.signTransaction(unsigned);
    const rawHash = await this.submitSigned(signed);
    // XRPL reports hashes as bare uppercase hex; the relay's API takes the 0x-prefixed form (the
    // Tron path normalises identically, and its hashes are natively unprefixed too).
    const hash = `0x${rawHash.replace(/^0x/, '').toLowerCase()}` as Hex;

    // Tell the relay a deposit tx exists so verifiers begin attesting it. The funds are already on
    // chain by now, so this is retried (notifying twice is harmless) and, if it still fails, the tx
    // hash goes into the error: without it the deposit cannot be polled or re-notified, and a
    // caller that only sees "notify failed" has lost the only handle to funds sitting in the reserve.
    try {
      // `retry` reacts to a throw, and `notify` reports failure in its Result — so rethrow to arm it.
      await retry(async () => {
        const res = await notify(this.relayApiUrl, this.chainId, hash);
        if (!res.ok) throw res.error;
      });
    } catch (error) {
      throw new Error(
        `[XrpSpokeService.deposit] deposit ${hash} submitted but the relay was not notified — re-notify this tx hash to settle it`,
        { cause: error },
      );
    }

    return hash satisfies string as TxReturnType<XrpChainKey, R>;
  }

  /**
   * Submit a signed Payment and return its hash.
   *
   * A browser wallet (GemWallet) submits as part of signing and returns a hash with no blob, so the
   * funds have already moved — submitting again is impossible and throwing would strand them unnotified.
   */
  private async submitSigned(signed: { tx_blob?: string; hash?: string }): Promise<string> {
    if (!signed.tx_blob) {
      if (!signed.hash) throw new Error('[XrpSpokeService.deposit] wallet returned neither a signed blob nor a hash');
      return signed.hash;
    }

    // The blob is signed, so a lost or provisional submit response does not prove it missed the
    // ledger (a ter* result can still apply later); keep the hash in the error so it can be looked up.
    let submitted: { engine_result?: string; tx_json?: { hash?: string } };
    try {
      submitted = await this.rpc<{ engine_result?: string; tx_json?: { hash?: string } }>('submit', {
        tx_blob: signed.tx_blob,
      });
    } catch (error) {
      throw new Error(`[XrpSpokeService.deposit] submit of ${signed.hash ?? 'unknown tx'} failed or timed out`, {
        cause: error,
      });
    }
    // tesSUCCESS is the only unambiguous accept; tec* codes are applied-but-failed and ter*/tem* are
    // rejections, so anything else would notify the relay about a tx that never moved funds.
    if (submitted.engine_result !== 'tesSUCCESS') {
      const txHash = signed.hash ?? submitted.tx_json?.hash ?? 'unknown tx';
      throw new Error(`[XrpSpokeService.deposit] submit of ${txHash} failed: ${submitted.engine_result ?? 'unknown'}`);
    }
    const hash = signed.hash ?? submitted.tx_json?.hash;
    if (!hash) throw new Error('[XrpSpokeService.deposit] submitted but no transaction hash returned');
    return hash;
  }

  /**
   * IOU amount object for a Payment. XRPL identifies an issued currency by (currency, issuer), and
   * the token's `address` carries the issuer — XRPL has no token contracts. The currency code is
   * derived from the symbol rather than looked up, so a newly listed IOU cannot miss a registry
   * entry (see {@link xrpCurrencyCode}).
   *
   * `value` is a decimal STRING in whole units, not drops: XRPL IOUs are decimal, so the base-unit
   * amount has to be scaled down by the token's decimals or the Payment moves 10^decimals too much.
   */
  private iouAmount(token: string, amount: bigint): { currency: string; issuer: string; value: string } {
    const entry = Object.values(this.chainConfig.supportedTokens).find(t => t.address === token);
    if (!entry) {
      throw new Error(`[XrpSpokeService.deposit] unknown XRPL token ${token} — not in supportedTokens`);
    }
    const scale = 10n ** BigInt(entry.decimals);
    const whole = amount / scale;
    const frac = amount % scale;
    const value =
      frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(entry.decimals, '0').replace(/0+$/, '')}`;
    return { currency: xrpCurrencyCode(entry.symbol), issuer: entry.address, value };
  }

  /**
   * Warn when the relay's reserve differs from the one in the chain config, without blocking.
   *
   * The relay's client contract is explicit that `reserveAddress` is not a constant and that a
   * client must pay the address from the current response rather than a cached or hard-coded one.
   * XRPL in particular SHARDS its reserve across lanes (`set_xrp_reserve`), and a payment to a
   * retired lane is not credited — so this cannot be a hard pin without stranding deposits on a
   * legitimate rotation. It stays a loud signal instead.
   */
  private warnOnUnknownReserve(reserveAddress: string): void {
    const expected = this.chainConfig.addresses.reserve;
    if (reserveAddress !== expected) {
      this.config.logger.warn(
        `[XrpSpokeService] MPC relay returned reserve ${reserveAddress}, chain config expects ${expected} — paying the relay's address, but the config may be stale (XRPL shards its reserve across lanes)`,
      );
    }
  }

  /**
   * Wait for the hub mint to land for an XRPL deposit, via the MPC relay's deposit record.
   * `txHash` is the source XRPL tx hash returned by {@link deposit}.
   */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    // `/notify` accepts a tx before its ledger is validated and never re-checks, so a notification
    // sent right after submit can land too early. Re-notifying is idempotent.
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, txHash);
    }, RENOTIFY_INTERVAL_MS);

    try {
      return await waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, txHash), {
        timeout: Math.max(timeout ?? 0, XRP_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  /**
   * On-chain balance for the deposit owner. XRPL memo-mode has no per-chain asset manager, so this
   * reads the holder's balance directly — native XRP from `account_info`, an IOU from the trustline
   * in `account_lines`.
   */
  public async getDeposit(params: GetDepositParams<XrpChainKey>): Promise<bigint> {
    const { token, srcAddress } = params;
    if (token === this.chainConfig.nativeToken) {
      const info = await this.rpc<{ account_data?: { Balance?: string } }>('account_info', {
        account: srcAddress,
        ledger_index: 'validated',
      });
      return BigInt(info.account_data?.Balance ?? '0');
    }

    const entry = Object.values(this.chainConfig.supportedTokens).find(t => t.address === token);
    if (!entry) throw new Error(`[XrpSpokeService.getDeposit] unknown XRPL token ${token}`);
    const currency = xrpCurrencyCode(entry.symbol);
    const lines = await this.rpc<{ lines?: { currency: string; account: string; balance: string }[] }>(
      'account_lines',
      { account: srcAddress, ledger_index: 'validated' },
    );
    const line = lines.lines?.find(l => l.currency === currency && l.account === entry.address);
    if (!line) return 0n;
    return toBaseUnits(line.balance, entry.decimals);
  }

  /**
   * Whether `address` can receive `amount` of `token` from a release.
   *
   * The account must exist: a native release to a missing account fails below the base reserve, and
   * an IOU release can never create one. An IOU also needs a trustline to its issuer with room for
   * the amount. Every one of these the relay treats as terminal, so check before submitting.
   */
  public async checkDestination(params: {
    address: string;
    token: string;
    amount: bigint;
  }): Promise<XrpDestinationReadiness> {
    const { address, token, amount } = params;
    try {
      await this.rpc('account_info', { account: address, ledger_index: 'validated' });
    } catch (error) {
      if (error instanceof Error && error.message.includes('actNotFound')) {
        return { ready: false, reason: 'account_not_found' };
      }
      throw error;
    }

    if (token === this.chainConfig.nativeToken) return { ready: true };

    const entry = Object.values(this.chainConfig.supportedTokens).find(t => t.address === token);
    if (!entry) throw new Error(`[XrpSpokeService.checkDestination] unknown XRPL token ${token}`);
    const currency = xrpCurrencyCode(entry.symbol);
    const lines = await this.rpc<{ lines?: { currency: string; account: string; balance: string; limit: string }[] }>(
      'account_lines',
      { account: address, peer: entry.address, ledger_index: 'validated' },
    );
    const line = lines.lines?.find(l => l.currency === currency && l.account === entry.address);
    if (!line) return { ready: false, reason: 'no_trustline' };
    if (toBaseUnits(line.balance, entry.decimals) + amount > toBaseUnits(line.limit, entry.decimals)) {
      return { ready: false, reason: 'trustline_limit' };
    }
    return { ready: true };
  }

  /**
   * The fee the ledger will burn for a Payment, in drops.
   *
   * XRPL charges a flat per-transaction fee rather than metering execution, so there is no
   * gas/limit pair to estimate — `server_info` reports the current base fee, which rises only
   * when the network is under load. Returned as drops so the caller can compare it against the
   * amount being sent.
   */
  public async estimateGas(_params: EstimateGasParams<XrpChainKey>): Promise<XrpGasEstimate> {
    const info = await this.rpc<{ info?: { validated_ledger?: { base_fee_xrp?: number } } }>('server_info', {});
    const baseFeeXrp = info.info?.validated_ledger?.base_fee_xrp;
    if (baseFeeXrp === undefined) {
      // A node that cannot report its fee is not a node to build a transaction against.
      throw new Error('[XrpSpokeService.estimateGas] server_info returned no base_fee_xrp');
    }
    return { fee: BigInt(Math.ceil(baseFeeXrp * 1_000_000)) };
  }

  /**
   * Withdraw / borrow (hub→XRPL) via the MPC relay's signature-mode pipeline.
   *
   * The `payload` is the hub-wallet calls to run (e.g. `AssetManager.transfer` that burns the
   * wrapped token and requests the release); `dstAddress` is the hub wallet that executes them. The
   * XRPL identity signs the withdraw-auth hash (scheme 3) and the relay verifies → burns on the hub
   * → MPC-signs the release to the XRPL recipient. Resolves to the `trackingId` to poll
   * {@link waitForWithdrawal} with. Raw mode is not supported — there is no spoke tx to return.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<XrpChainKey, Raw>,
  ): Promise<TxReturnType<XrpChainKey, Raw>> {
    if ('raw' in params && params.raw) {
      throw new Error('[XrpSpokeService.sendMessage] raw mode is not supported for XRPL withdrawals');
    }

    const sender = xrpIdentityBytes(params.srcAddress);
    const message = {
      to: params.dstAddress as Hex, // hub wallet that executes the calls
      data: params.payload,
      nonce: randomWithdrawNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender,
    };

    // Scheme 3 signs the RAW 32-byte hash — no prefix, no envelope, unlike scheme 1's TIP-191
    // wrapping. The public key rides along because an ed25519 signature cannot recover its signer:
    // the contract derives ripemd160(sha256(publicKey)) and compares it to `sender`.
    const hash = computeSignedMessageHash(message);
    const [signature, publicKey] = await Promise.all([
      params.walletProvider.signMessage(hash),
      params.walletProvider.getPublicKey(),
    ]);

    const res = await submitWithdraw(this.relayApiUrl, {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      signature,
      scheme: getMpcRelayChainInfo(ChainKeys.XRP_MAINNET).withdrawScheme,
      publicKey,
    });
    if (!res.ok) throw res.error;

    return res.value.trackingId satisfies string as TxReturnType<XrpChainKey, Raw>;
  }

  /**
   * Wait for a hub→XRPL withdrawal to reach `released`, via the MPC relay.
   * `trackingId` is the value returned by {@link sendMessage}.
   */
  public async waitForWithdrawal(trackingId: string, timeout?: number): Promise<Result<WithdrawalRecord>> {
    return waitForWithdrawal(this.relayApiUrl, trackingId, {
      timeout: Math.max(timeout ?? 0, XRP_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /** Poll rippled until the transaction is in a validated ledger, mapping it to the SDK shape. */
  public async waitForTransactionReceipt(
    params: WaitForTxReceiptParams<XrpChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<XrpChainKey>>> {
    const { txHash } = params;
    const pollingIntervalMs = params.pollingIntervalMs ?? this.chainConfig.pollingConfig.pollingIntervalMs;
    const maxTimeoutMs = params.maxTimeoutMs ?? this.chainConfig.pollingConfig.maxTimeoutMs;
    const maxAttempts = Math.max(1, Math.round(maxTimeoutMs / pollingIntervalMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tx = await this.rpc<XrpRawTransactionReceipt>('tx', {
          transaction: txHash.replace(/^0x/, '').toUpperCase(),
          binary: false,
        });
        // Only a VALIDATED ledger is final on XRPL; an unvalidated result can still change.
        if (tx.validated) {
          const result = tx.meta?.TransactionResult;
          if (result && result !== 'tesSUCCESS') {
            return { ok: true, value: { status: 'failure', error: new Error(`xrpl tx failed: ${result}`) } };
          }
          return { ok: true, value: { status: 'success', receipt: tx } };
        }
      } catch (error) {
        // `txnNotFound` is expected until the tx is in a ledger, so a poll error is not terminal.
        this.config.logger.debug('[XrpSpokeService.waitForTransactionReceipt] poll error', { error });
      }
      await new Promise(r => setTimeout(r, pollingIntervalMs));
    }
    return { ok: true, value: { status: 'timeout', error: new Error(`xrpl tx ${txHash} not validated in time`) } };
  }
}

/** An XRPL decimal IOU amount in base units, truncated to `decimals`. */
function toBaseUnits(value: string, decimals: number): bigint {
  const [whole = '0', frac = ''] = value.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}
