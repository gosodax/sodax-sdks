import { IndeterminateOutcomeError, isIndeterminateOutcomeError } from '../../../errors/IndeterminateOutcomeError.js';
import { pollUntil } from '../../utils/pollUntil.js';
import { resolveTimeoutMs } from '../../utils/resolveTimeoutMs.js';
import { bytesToHex, hexToBytes, isAddress, ripemd160, sha256, type Hex } from 'viem';
import {
  ChainKeys,
  getMpcRelayChainInfo,
  type IXrpWalletProvider,
  type Result,
  type XrpChainKey,
  type XrpDepositReturnType,
  type XrpRawTransaction,
  type XrpRawWithdraw,
  type XrpSendMessageReturnType,
  type XrpRawTransactionReceipt,
  type XrpSpokeChainConfig,
  type XrpGasEstimate,
  type XrpUnsignedTransaction,
  type XrpUnsignedTrustSet,
  type WalletProviderSlot,
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
  computePayloadHash,
  getDeposit,
  getDepositAddress,
  getWithdrawal,
  notify,
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
import { computeSignedMessageHash, randomWithdrawNonce } from './mpc-message.js';
import { xrpIdentityBytes, xrpTokenRef } from './xrp-utils.js';
import { createBalanceCollector, settleWalletBalances, type WalletBalanceMap } from './balance-utils.js';

const XRP_RPC_TIMEOUT_MS = 15_000;

/** Floor over the caller's settlement timeout: aggregation, the NEAR submit and the hub tx (and a release) must still clear. */
const XRP_SETTLEMENT_FLOOR_MS = 300_000;

/** Relay re-notify interval while waiting for a deposit — a couple of ledger closes. */
const RENOTIFY_INTERVAL_MS = 6_000;

/** AccountRoot flags that make rippled refuse a Payment carrying no DestinationTag, or from an unauthorized sender. */
const LSF_REQUIRE_DEST_TAG = 0x00020000;
const LSF_DEPOSIT_AUTH = 0x01000000;
/** RippleState flags for a deep freeze set by either side, which stops the holder receiving from anyone but the issuer. */
const LSF_DEEP_FREEZE = 0x02000000 | 0x04000000;
/** Issuer AccountRoot flags: holders need its authorization, or its tokens move only to and from it. */
const LSF_REQUIRE_AUTH = 0x00040000;
const LSF_GLOBAL_FREEZE = 0x00400000;
// RippleState flags: the low or high account has an owner reserve locked for this line.
const LSF_LOW_RESERVE = 0x00010000;
const LSF_HIGH_RESERVE = 0x00020000;
/** `TransferRate` billionths meaning no issuer transfer fee; an absent or 0 rate means none too. */
const TRANSFER_RATE_NONE = 1_000_000_000;

/** TrustSet flag that sets NoRipple on the holder's side, so the line cannot be used to ripple other holders' balances. */
const TF_SET_NO_RIPPLE = 0x00020000;
/** The largest issued-currency amount XRPL represents, used as the trustline limit so it never runs out of room. */
const XRP_MAX_IOU_LIMIT = '9999999999999999e80';

export type RequestXrpTrustlineParams<Raw extends boolean> = {
  srcAddress: string;
  token: string;
} & WalletProviderSlot<XrpChainKey, Raw>;

export type RequestXrpTrustlineReturnType<Raw extends boolean> = Raw extends true ? XrpUnsignedTrustSet : string;

type XrpTrustLine = { currency: string; account: string; balance: string; limit: string; peer_authorized?: boolean };

/** rippled's error for an address that has never been funded. */
function isAccountNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.includes('actNotFound');
}

/** `fallback` when rippled reports the account or ledger entry does not exist; any other error still throws. */
async function orIfMissing<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof Error && /actNotFound|entryNotFound/.test(error.message)) return fallback;
    throw error;
  }
}

async function signedBlobHash(blob: string): Promise<Hex> {
  const bytes = new Uint8Array(hexToBytes(`0x54584E00${blob}`));
  const digest = await globalThis.crypto.subtle.digest('SHA-512', bytes);
  return bytesToHex(new Uint8Array(digest, 0, 32));
}

/** XRPL reports bare uppercase hex; the relay keys XRPL on the 0x-prefixed lowercase form (per chain: Tron's key is bare hex). */
function toRelayTxHash(txHash: string): string {
  const bare = txHash.replace(/^0x/i, '').toLowerCase();
  return bare && `0x${bare}`;
}

/**
 * Whether an XRPL account can receive a release. The relay treats an unpayable destination as TERMINAL after
 * the hub already burned the funds, so check this before withdrawing or borrowing to an XRPL address.
 */
export type XrpDestinationReadiness =
  | { ready: true }
  | {
      ready: false;
      reason:
        | 'account_not_found'
        | 'destination_tag_required'
        | 'deposit_auth'
        | 'issuer_frozen'
        | 'issuer_transfer_fee'
        | 'no_trustline'
        | 'trustline_unauthorized'
        | 'trustline_frozen'
        | 'trustline_limit';
    };

/**
 * XRPL spoke: deposits ride the MPC relay in memo mode (32-byte payload-hash memo). Withdrawals use auth scheme 3:
 * a RAW ed25519 signature, plus the `0xED`-prefixed public key since ed25519 cannot recover its signer.
 */
export class XrpSpokeService implements MpcRelaySettlement {
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    this.config = config;
  }

  // Read live: `ConfigService` can swap in backend config after construction, which would leave a pinned reserve stale.
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

  /** The timeout signal covers the body read too: a node can send headers and then stall the stream. */
  private async rpc<T>(method: string, params: Record<string, unknown>, timeoutMs = XRP_RPC_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        throw new Error(`xrpl rpc ${method}: timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Deposit XRP or an IOU via the MPC relay (memo Payment). A definite submit failure throws, an uncertain one throws
   * IndeterminateOutcomeError with the hash; the RESERVE must already hold a trustline for an IOU or the Payment fails.
   */
  public async deposit<R extends boolean = false>(
    params: DepositParams<XrpChainKey, R>,
  ): Promise<XrpDepositReturnType<R>> {
    const { srcAddress, token, amount, data, to } = params;
    const isNative = token === this.chainConfig.nativeToken;

    // A signer that could never withdraw must not deposit; a raw deposit's caller owns that check.
    if (!('raw' in params && params.raw)) await this.assertSignerCanWithdraw(params.walletProvider, srcAddress);

    const addr = await getDepositAddress(this.relayApiUrl, srcAddress, this.chainId, data);
    if (!addr.ok) throw addr.error;
    if (addr.value.depositMethod !== 'memo') {
      throw new Error(
        `[XrpSpokeService.deposit] relay returned a ${addr.value.depositMethod}-mode deposit, expected memo`,
      );
    }
    const { reserveAddress, memo, hubWallet } = addr.value;
    this.warnOnUnknownReserve(reserveAddress);

    // The relay derives the hub wallet from `srcAddress`, so `to` is only an assertion; a mismatch means the identity
    // encoding drifted from the relay's.
    if (to.toLowerCase() !== hubWallet.toLowerCase()) {
      throw new Error(
        `[XrpSpokeService.deposit] relay derives hub wallet ${hubWallet} for ${srcAddress}, but the deposit targets ${to}`,
      );
    }

    // Verifiers attest whatever payload the relay stored under the memo, so the memo must commit to our `data`.
    const expectedMemo = computePayloadHash(hubWallet, data);
    if (memo.toLowerCase() !== expectedMemo) {
      throw new Error(
        `[XrpSpokeService.deposit] relay memo ${memo} does not commit to this deposit's payload (expected ${expectedMemo})`,
      );
    }

    const unsigned: XrpUnsignedTransaction = {
      TransactionType: 'Payment',
      Account: srcAddress,
      Destination: reserveAddress,
      Amount: isNative ? amount.toString() : this.iouAmount(token, amount),
      // MemoData is plain hex without `0x` — this is what the relay matches the deposit on.
      Memos: [{ Memo: { MemoData: memo.replace(/^0x/, '').toUpperCase() } }],
    };

    if ('raw' in params && params.raw) {
      return {
        from: srcAddress,
        to: reserveAddress,
        value: amount,
        data: memo,
        token,
        transaction: unsigned,
      } satisfies XrpRawTransaction as XrpDepositReturnType<R>;
    }

    const walletProvider = params.walletProvider;

    // Sequence/Fee/LastLedgerSequence are left to the wallet: GemWallet rejects a tx that pins them, and filling them
    // here would race the wallet for the account's Sequence.
    let hash: string;
    let uncertain: IndeterminateOutcomeError | undefined;
    try {
      const signed = await walletProvider.signTransaction(unsigned);
      hash = toRelayTxHash(await this.submitSigned(signed));
    } catch (error) {
      if (!isIndeterminateOutcomeError(error) || !error.txHash) throw error;
      uncertain = error;
      hash = error.txHash;
    }

    const submitted = await this.submitDeposit(hash);
    if (!submitted.ok) {
      this.warnWithoutInterruptingDeposit(
        '[XrpSpokeService.deposit] relay notify failed; settle or submitMpcDeposit re-notifies it',
        {
          hash,
          error: submitted.error,
        },
      );
    }

    if (uncertain) throw uncertain;
    return hash satisfies string as XrpDepositReturnType<R>;
  }

  private warnWithoutInterruptingDeposit(...args: Parameters<ConfigService['logger']['warn']>): void {
    try {
      this.config.logger.warn(...args);
    } catch {
      // Settlement must retain its hash even if a caller's logger throws.
    }
  }

  /** Notify the relay of a submitted deposit with retries; a failure keeps the tx hash, the only handle to re-notify. */
  public async submitDeposit(txHash: string): Promise<Result<void>> {
    try {
      await this.retryNotify(() => notify(this.relayApiUrl, this.chainId, toRelayTxHash(txHash)));
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

  /**
   * Refuses a deposit its signer could never withdraw: scheme 3 takes only an ed25519 key matching
   * `ripemd160(sha256(publicKey))`, so a secp256k1 or regular key would strand the deposit on the hub.
   */
  private async assertSignerCanWithdraw(walletProvider: IXrpWalletProvider, srcAddress: string): Promise<void> {
    const publicKey = await walletProvider.getPublicKey();
    if (!publicKey.toLowerCase().startsWith('0xed')) {
      throw new Error(`[XrpSpokeService.deposit] ${srcAddress} signs with a non-ed25519 key, which can never withdraw`);
    }
    if (ripemd160(sha256(publicKey)) !== xrpIdentityBytes(srcAddress).toLowerCase()) {
      throw new Error(`[XrpSpokeService.deposit] the wallet's key is not ${srcAddress}'s, so it could never withdraw`);
    }
  }

  /** A browser wallet (GemWallet) submits while signing and returns a hash with no blob, so never resubmit or throw. */
  private async submitSigned(signed: { tx_blob?: string; hash?: string }): Promise<string> {
    if (!signed.tx_blob) {
      if (!signed.hash) throw new Error('[XrpSpokeService.deposit] wallet returned neither a signed blob nor a hash');
      return signed.hash;
    }

    // XRPL transaction ID is SHA-512Half of the transaction-ID prefix and signed bytes.
    const blob = signed.tx_blob;
    if (!/^(?:[0-9a-f]{2})+$/i.test(blob)) throw new Error('[XrpSpokeService.deposit] invalid signed blob');
    const hash = toRelayTxHash(await signedBlobHash(blob));
    const indeterminate = (cause: unknown) =>
      new IndeterminateOutcomeError('[XrpSpokeService.deposit] submit outcome is unknown', { txHash: hash, cause });

    let submitted: { engine_result?: unknown };
    try {
      submitted = await this.rpc<{ engine_result?: unknown }>('submit', { tx_blob: blob });
    } catch (error) {
      throw indeterminate(error);
    }
    const result = typeof submitted.engine_result === 'string' ? submitted.engine_result : undefined;
    if (result === 'tesSUCCESS' || result === 'terQUEUED') return hash;
    const failure = new Error(`[XrpSpokeService.deposit] submit of ${hash} failed: ${result ?? 'unknown'}`);
    if (result && /^tem[A-Z][A-Z0-9_]*$/.test(result)) throw failure;
    throw indeterminate(failure);
  }

  /**
   * IOU amount for a Payment; an issuer-only `address` derives the currency from the symbol (see {@link xrpTokenRef}).
   * `value` is a decimal string in whole units, not drops, so base units are scaled down by the token's decimals.
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
    const { currency, issuer } = xrpTokenRef(entry);
    return { currency, issuer, value };
  }

  /**
   * Warn, never block, when the relay's reserve differs from config: XRPL shards its reserve across lanes and the
   * relay requires paying the current response's address, so a hard pin would strand deposits on rotation.
   */
  private warnOnUnknownReserve(reserveAddress: string): void {
    const expected = this.chainConfig.addresses.reserve;
    if (reserveAddress !== expected) {
      this.warnWithoutInterruptingDeposit(
        `[XrpSpokeService] MPC relay returned reserve ${reserveAddress}, chain config expects ${expected} — paying the relay's address, but the config may be stale (XRPL shards its reserve across lanes)`,
      );
    }
  }

  /** Wait for the hub mint for an XRPL deposit (`txHash` as returned by {@link deposit}). */
  public async waitForDeposit(txHash: string, timeout?: number): Promise<Result<DepositRecord>> {
    const hash = toRelayTxHash(txHash);
    // `/notify` accepts a tx before its ledger validates and never re-checks, so re-notify (idempotent).
    const renotify = setInterval(() => {
      void notify(this.relayApiUrl, this.chainId, hash);
    }, RENOTIFY_INTERVAL_MS);

    try {
      return await waitForDeposit(this.relayApiUrl, toDepositId(this.chainId, hash), {
        timeout: Math.max(resolveTimeoutMs(timeout, 0), XRP_SETTLEMENT_FLOOR_MS),
        pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
      });
    } finally {
      clearInterval(renotify);
    }
  }

  public async getDepositRecord(txHash: string): Promise<Result<DepositRecord>> {
    return getDeposit(this.relayApiUrl, toDepositId(this.chainId, toRelayTxHash(txHash)));
  }

  /** XRPL memo-mode has no asset manager, so this reads the holder's own balance (`account_info` / `account_lines`). */
  public async getDeposit(params: GetDepositParams<XrpChainKey>): Promise<bigint> {
    try {
      return await this.readBalance(params.srcAddress, params.token);
    } catch (error) {
      // An address nobody has funded yet holds nothing, as an unactivated Tron account reads 0.
      if (isAccountNotFound(error)) return 0n;
      throw error;
    }
  }

  private async readBalance(srcAddress: string, token: string): Promise<bigint> {
    if (token === this.chainConfig.nativeToken) {
      const info = await this.rpc<{ account_data?: { Balance?: string } }>('account_info', {
        account: srcAddress,
        ledger_index: 'validated',
      });
      return BigInt(info.account_data?.Balance ?? '0');
    }

    const entry = Object.values(this.chainConfig.supportedTokens).find(t => t.address === token);
    if (!entry) throw new Error(`[XrpSpokeService.getDeposit] unknown XRPL token ${token}`);
    const { currency, issuer } = xrpTokenRef(entry);
    let marker: unknown;
    do {
      const page = await this.rpc<{
        lines?: { currency: string; account: string; balance: string }[];
        marker?: unknown;
      }>('account_lines', {
        account: srcAddress,
        peer: issuer,
        ledger_index: 'validated',
        ...(marker === undefined ? {} : { marker }),
      });
      const line = page.lines?.find(l => l.currency === currency && l.account === issuer);
      if (line) return toBaseUnits(line.balance, entry.decimals);
      marker = page.marker;
    } while (marker !== undefined);
    return 0n;
  }

  public async getWalletBalance(params: GetBalanceParams<XrpChainKey>): Promise<bigint> {
    return this.getDeposit({
      srcChainKey: params.srcChainKey,
      srcAddress: params.srcAddress,
      token: params.token.address,
    });
  }

  /** Keyed by `token.address`. */
  public async getWalletBalances(params: GetBalancesParams<XrpChainKey>): Promise<WalletBalanceMap> {
    const { srcChainKey, srcAddress, tokens } = params;
    const collector = createBalanceCollector({ logger: this.config.logger, chainKey: srcChainKey });
    await settleWalletBalances(collector, tokens, token => this.getWalletBalance({ srcChainKey, srcAddress, token }));
    return collector.finish();
  }

  /**
   * Whether `address` can receive a release, checked before the hub burns. `maxAmount` (default `amount`) is the most
   * a solver fill can deliver, which the trustline must have room for; amounts are in the token's decimals.
   */
  public async checkDestination(params: {
    address: string;
    token: string;
    amount: bigint;
    maxAmount?: bigint;
  }): Promise<XrpDestinationReadiness> {
    const { address, token, amount, maxAmount = amount } = params;
    const iou =
      token === this.chainConfig.nativeToken
        ? undefined
        : Object.values(this.chainConfig.supportedTokens).find(t => t.address === token);
    if (token !== this.chainConfig.nativeToken && !iou) {
      throw new Error(`[XrpSpokeService.checkDestination] unknown XRPL token ${token}`);
    }
    const ref = iou ? xrpTokenRef(iou) : undefined;
    const needsTrustline = ref !== undefined && address !== ref.issuer;

    // Independent reads, so they run together; only creating an account needs one more.
    const [account, trustline] = await Promise.all([
      this.readAccountRoot(address),
      needsTrustline ? this.readTrustline(address, ref.issuer, ref.currency) : undefined,
    ]);
    if (account === undefined) {
      if (!iou && amount >= (await this.readBaseReserveDrops())) return { ready: true };
      return { ready: false, reason: 'account_not_found' };
    }
    if (account.flags & LSF_REQUIRE_DEST_TAG) return { ready: false, reason: 'destination_tag_required' };
    if (account.flags & LSF_DEPOSIT_AUTH) return { ready: false, reason: 'deposit_auth' };
    if (!iou || !trustline) return { ready: true };

    const { line, stateFlags, issuer } = trustline;
    // The relay holds a release through a global freeze, past any wait the caller can make (forever under NoFreeze).
    if (issuer.flags & LSF_GLOBAL_FREEZE) return { ready: false, reason: 'issuer_frozen' };
    const rate = issuer.transferRate;
    if (rate && rate !== TRANSFER_RATE_NONE) return { ready: false, reason: 'issuer_transfer_fee' };
    // Before `no_trustline`: a holder's own TrustSet cannot satisfy an issuer that requires authorization.
    if (issuer.flags & LSF_REQUIRE_AUTH && !line?.peer_authorized) {
      return { ready: false, reason: 'trustline_unauthorized' };
    }
    if (!line) return { ready: false, reason: 'no_trustline' };
    if (stateFlags & LSF_DEEP_FREEZE) return { ready: false, reason: 'trustline_frozen' };
    if (maxAmount > trustlineRoom(line.limit, line.balance, iou.decimals)) {
      return { ready: false, reason: 'trustline_limit' };
    }
    return { ready: true };
  }

  public requiresTrustline(token: string): boolean {
    return token !== this.chainConfig.nativeToken && this.findIou(token) !== undefined;
  }

  /**
   * Whether `address` can pay the TrustSet fee plus one owner reserve, unless the line already holds one on its side;
   * like rippled, an account owning fewer than two objects needs only the fee.
   */
  public async canAffordTrustline(params: { address: string; token: string }): Promise<boolean> {
    const { address, token } = params;
    const iou = this.findIou(token);
    if (!iou) throw new Error(`[XrpSpokeService.canAffordTrustline] ${token} is not an XRPL issued currency`);
    const { currency, issuer } = xrpTokenRef(iou);

    const [info, reserves, fee, trustline] = await Promise.all([
      orIfMissing(
        this.rpc<{ account_data?: { Balance?: string; OwnerCount?: number } }>('account_info', {
          account: address,
          ledger_index: 'validated',
        }),
        undefined,
      ),
      this.readReservesDrops(),
      this.readFeeDrops(),
      this.readTrustline(address, issuer, currency),
    ]);
    if (!info?.account_data) return false;

    const balance = BigInt(info.account_data.Balance ?? '0');
    const ownerCount = info.account_data.OwnerCount ?? 0;
    const locked = reserves.base + BigInt(ownerCount) * reserves.increment;
    const reserveWaived = trustline.holderReserved || ownerCount < 2;
    const needed = fee + (reserveWaived ? 0n : reserves.increment);
    return balance - locked >= needed;
  }

  /**
   * Create or raise `srcAddress`'s trustline for `token` to the max limit with NoRipple. A possibly-sent TrustSet with
   * unknown outcome throws IndeterminateOutcomeError with the hash: check it before re-signing (each costs a fee).
   */
  public async requestTrustline<Raw extends boolean>(
    params: RequestXrpTrustlineParams<Raw>,
  ): Promise<Result<RequestXrpTrustlineReturnType<Raw>>> {
    try {
      const { srcAddress, token } = params;
      const iou = this.findIou(token);
      if (!iou) throw new Error(`[XrpSpokeService.requestTrustline] ${token} is not an XRPL issued currency`);
      const { currency, issuer } = xrpTokenRef(iou);

      const unsigned: XrpUnsignedTrustSet = {
        TransactionType: 'TrustSet',
        Account: srcAddress,
        LimitAmount: { currency, issuer, value: XRP_MAX_IOU_LIMIT },
        Flags: TF_SET_NO_RIPPLE,
      };
      if (params.raw === true) {
        return { ok: true, value: unsigned satisfies XrpUnsignedTrustSet as RequestXrpTrustlineReturnType<Raw> };
      }

      const walletProvider = params.walletProvider;
      if (!walletProvider?.signTrustSet) {
        throw new Error('[XrpSpokeService.requestTrustline] the XRPL wallet provider cannot sign a TrustSet');
      }
      const signed = await walletProvider.signTrustSet(unsigned);
      const hash = signed.tx_blob ? await this.submitTrustSet(signed.tx_blob) : signed.hash?.toUpperCase();
      if (!hash) throw new Error('[XrpSpokeService.requestTrustline] wallet returned neither a signed blob nor a hash');

      const unknown = (cause: unknown) =>
        new IndeterminateOutcomeError(`[XrpSpokeService.requestTrustline] outcome of ${hash} is unknown`, {
          txHash: hash,
          cause,
        });
      const receipt = await this.waitForTransactionReceipt({ chainKey: ChainKeys.XRP_MAINNET, txHash: hash });
      if (!receipt.ok) throw unknown(receipt.error);
      if (receipt.value.status === 'failure') throw receipt.value.error;
      if (receipt.value.status !== 'success') throw unknown(receipt.value.error);
      // The shared receipt counts a validated transaction with no result as success; a TrustSet needs tesSUCCESS.
      const result = receipt.value.receipt.meta?.TransactionResult;
      if (result !== 'tesSUCCESS') throw unknown(new Error(`xrpl tx ${hash} validated without tesSUCCESS`));
      return { ok: true, value: hash satisfies string as RequestXrpTrustlineReturnType<Raw> };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** Only a `tem` verdict means a TrustSet can never apply; any other failure may still validate, so it is indeterminate. */
  private async submitTrustSet(blob: string): Promise<string> {
    if (!/^(?:[0-9a-f]{2})+$/i.test(blob)) throw new Error('[XrpSpokeService.requestTrustline] invalid signed blob');
    // No relay keys a TrustSet, so its hash keeps XRPL's own bare uppercase form.
    const hash = (await signedBlobHash(blob)).slice(2).toUpperCase();
    const indeterminate = (cause: unknown) =>
      new IndeterminateOutcomeError('[XrpSpokeService.requestTrustline] submit outcome is unknown', {
        txHash: hash,
        cause,
      });
    let submitted: { engine_result?: unknown };
    try {
      submitted = await this.rpc<{ engine_result?: unknown }>('submit', { tx_blob: blob });
    } catch (error) {
      throw indeterminate(error);
    }
    const result = typeof submitted.engine_result === 'string' ? submitted.engine_result : undefined;
    if (result === 'tesSUCCESS' || result === 'terQUEUED') return hash;
    const failure = new Error(`[XrpSpokeService.requestTrustline] submit of ${hash} failed: ${result ?? 'unknown'}`);
    if (result && /^tem[A-Z][A-Z0-9_]*$/.test(result)) throw failure;
    throw indeterminate(failure);
  }

  private findIou(token: string) {
    return Object.values(this.chainConfig.supportedTokens).find(
      t => t.address === token && t.address !== this.chainConfig.nativeToken,
    );
  }

  /** `undefined` for an address nobody has funded yet. */
  private async readAccountRoot(account: string): Promise<{ flags: number; transferRate?: number } | undefined> {
    const info = await orIfMissing(
      this.rpc<{ account_data?: { Flags?: number; TransferRate?: number } }>('account_info', {
        account,
        ledger_index: 'validated',
      }),
      undefined,
    );
    return info && { flags: info.account_data?.Flags ?? 0, transferRate: info.account_data?.TransferRate };
  }

  /** The least a Payment can carry to create an account. */
  private async readBaseReserveDrops(): Promise<bigint> {
    const res = await this.rpc<{ state?: { validated_ledger?: { reserve_base?: number } } }>('server_state', {});
    const reserve = res.state?.validated_ledger?.reserve_base;
    if (typeof reserve !== 'number') throw new Error('[XrpSpokeService] server_state returned no reserve_base');
    return BigInt(reserve);
  }

  private async readReservesDrops(): Promise<{ base: bigint; increment: bigint }> {
    const res = await this.rpc<{ state?: { validated_ledger?: { reserve_base?: number; reserve_inc?: number } } }>(
      'server_state',
      {},
    );
    const { reserve_base: base, reserve_inc: increment } = res.state?.validated_ledger ?? {};
    if (typeof base !== 'number') throw new Error('[XrpSpokeService] server_state returned no reserve_base');
    if (typeof increment !== 'number') throw new Error('[XrpSpokeService] server_state returned no reserve_inc');
    return { base: BigInt(base), increment: BigInt(increment) };
  }

  private async readTrustline(holder: string, issuer: string, currency: string) {
    const [lines, state, issuerRoot] = await Promise.all([
      orIfMissing(
        this.rpc<{ lines?: XrpTrustLine[] }>('account_lines', {
          account: holder,
          peer: issuer,
          ledger_index: 'validated',
        }),
        { lines: [] },
      ),
      // account_lines reports only the ordinary freeze, which still lets the holder receive; a deep freeze does not.
      orIfMissing(
        this.rpc<{ node?: { Flags?: number; LowLimit?: { issuer?: string } } }>('ledger_entry', {
          ripple_state: { accounts: [holder, issuer], currency },
          ledger_index: 'validated',
        }),
        {},
      ),
      this.readAccountRoot(issuer),
    ]);
    const stateFlags = state.node?.Flags ?? 0;
    // RippleState names its low account in LowLimit.issuer; each side has its own reserve flag.
    const holderIsLow = state.node?.LowLimit?.issuer === holder;
    return {
      // The two reads can land on different ledgers; a line whose RippleState is gone no longer exists.
      line: state.node && lines.lines?.find(l => l.currency === currency && l.account === issuer),
      stateFlags,
      holderReserved: (stateFlags & (holderIsLow ? LSF_LOW_RESERVE : LSF_HIGH_RESERVE)) !== 0,
      issuer: issuerRoot ?? { flags: 0 },
    };
  }

  /** Open-ledger Payment fee in drops, falling back to the base fee. */
  public async estimateGas(_params: EstimateGasParams<XrpChainKey>): Promise<XrpGasEstimate> {
    return { fee: await this.readFeeDrops() };
  }

  private async readFeeDrops(): Promise<bigint> {
    const info = await this.rpc<{ drops?: { open_ledger_fee?: string; base_fee?: string } }>('fee', {});
    const fee = info.drops?.open_ledger_fee ?? info.drops?.base_fee;
    if (fee === undefined) throw new Error('[XrpSpokeService.estimateGas] fee returned no ledger fee');
    return BigInt(fee);
  }

  /**
   * Withdraw / borrow (hub→XRPL) via the MPC relay: the XRPL identity signs the scheme-3 withdraw-auth, the relay burns
   * on the hub and MPC-signs the release. Resolves to the `trackingId` for {@link waitForWithdrawal}.
   */
  public async sendMessage<Raw extends boolean>(
    params: SendMessageParams<XrpChainKey, Raw>,
  ): Promise<XrpSendMessageReturnType<Raw>> {
    const withdraw = this.buildWithdraw(params.srcAddress, params.dstAddress, params.payload);
    if ('raw' in params && params.raw) return withdraw satisfies XrpRawWithdraw as XrpSendMessageReturnType<Raw>;

    // Scheme 3 signs the RAW 32-byte digest — no prefix, no envelope, unlike scheme 1's TIP-191 wrapping.
    const [signature, publicKey] = await Promise.all([
      params.walletProvider.signMessage(withdraw.digest),
      params.walletProvider.getPublicKey(),
    ]);
    const trackingId = await submitFreshWithdrawWithBackoff(() =>
      this.submitSignedWithdraw({ withdraw, signature, publicKey }),
    );
    return trackingId satisfies string as XrpSendMessageReturnType<Raw>;
  }

  /**
   * Submit a signed withdraw-auth; the account's `0xED` public key rides along for the contract's AccountID check.
   * On IndeterminateOutcomeError poll the original trackingId: a resubmission's rejection does not settle the first.
   */
  public async submitSignedWithdraw({
    withdraw,
    signature,
    publicKey,
  }: {
    withdraw: XrpRawWithdraw;
    signature: Hex;
    publicKey: Hex;
  }): Promise<string> {
    const { message, digest, scheme } = withdraw;
    const expectedScheme = getMpcRelayChainInfo(ChainKeys.XRP_MAINNET).withdrawScheme;
    if (scheme !== expectedScheme) {
      throw new Error(`[XrpSpokeService.submitSignedWithdraw] scheme ${scheme} is not XRPL's (${expectedScheme})`);
    }
    const expectedDigest = computeSignedMessageHash({
      ...message,
      nonce: BigInt(message.nonce),
      chainId: BigInt(message.chainId),
    });
    if (digest.toLowerCase() !== expectedDigest) {
      throw new Error(
        `[XrpSpokeService.submitSignedWithdraw] digest ${digest} does not match the message (${expectedDigest})`,
      );
    }
    if (!/^0xed[0-9a-f]{64}$/i.test(publicKey) || ripemd160(sha256(publicKey)) !== message.sender.toLowerCase()) {
      throw new Error('[XrpSpokeService.submitSignedWithdraw] publicKey is not the ed25519 key of the message sender');
    }

    const res = await submitWithdraw(this.relayApiUrl, { message, signature, scheme, publicKey });
    if (!res.ok) throw res.error;
    return res.value.trackingId;
  }

  private buildWithdraw(srcAddress: string, hubWallet: string, payload: Hex): XrpRawWithdraw {
    // `data` is variable-length inside the signed digest's unframed concat, so `to` must be exactly 20 bytes.
    if (!isAddress(hubWallet)) {
      throw new Error(`[XrpSpokeService.sendMessage] invalid hub wallet address: ${hubWallet}`);
    }
    const message = {
      to: hubWallet, // hub wallet that executes the calls
      data: payload,
      nonce: randomWithdrawNonce(),
      chainId: BigInt(this.chainId), // the relay's source-chain id, not the hub's
      sender: xrpIdentityBytes(srcAddress),
    };
    return {
      message: { ...message, nonce: message.nonce.toString(), chainId: message.chainId.toString() },
      digest: computeSignedMessageHash(message),
      scheme: getMpcRelayChainInfo(ChainKeys.XRP_MAINNET).withdrawScheme,
    };
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
      timeout: Math.max(resolveTimeoutMs(timeout, 0), XRP_SETTLEMENT_FLOOR_MS),
      pollIntervalMs: this.chainConfig.pollingConfig.pollingIntervalMs,
    });
  }

  /** Notify the relay of a hub tx releasing to XRPL; it has no hub watcher and learns of it only through `/notify`. */
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
        timeout: Math.max(resolveTimeoutMs(timeout, 0), XRP_SETTLEMENT_FLOOR_MS),
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
    params: WaitForTxReceiptParams<XrpChainKey>,
  ): Promise<Result<WaitForTxReceiptReturnType<XrpChainKey>>> {
    const { txHash } = params;
    const pollingIntervalMs = resolveTimeoutMs(
      params.pollingIntervalMs,
      this.chainConfig.pollingConfig.pollingIntervalMs,
    );
    const maxTimeoutMs = resolveTimeoutMs(params.maxTimeoutMs, this.chainConfig.pollingConfig.maxTimeoutMs);

    const settled = await pollUntil<WaitForTxReceiptReturnType<XrpChainKey>>(
      async remainingMs => {
        try {
          const tx = await this.rpc<XrpRawTransactionReceipt>(
            'tx',
            {
              transaction: txHash.replace(/^0x/, '').toUpperCase(),
              binary: false,
            },
            Math.min(XRP_RPC_TIMEOUT_MS, remainingMs),
          );
          // Only a VALIDATED ledger is final on XRPL; an unvalidated result can still change.
          if (tx.validated) {
            const result = tx.meta?.TransactionResult;
            if (result && result !== 'tesSUCCESS') {
              return { status: 'failure', error: new Error(`xrpl tx failed: ${result}`) };
            }
            return { status: 'success', receipt: tx };
          }
        } catch (error) {
          // `txnNotFound` is expected until the tx is in a ledger, so a poll error is not terminal.
          this.config.logger.debug('[XrpSpokeService.waitForTransactionReceipt] poll error', { error });
        }
        return undefined;
      },
      { timeoutMs: maxTimeoutMs, intervalMs: pollingIntervalMs },
    );
    if (settled !== undefined) return { ok: true, value: settled };
    return { ok: true, value: { status: 'timeout', error: new Error(`xrpl tx ${txHash} not validated in time`) } };
  }
}

/** Truncated to `decimals`; rippled uses `<mantissa>e<exponent>` outside exponents -25..-5. */
function toBaseUnits(value: string, decimals: number): bigint {
  const { mantissa, exponent } = parseXrplDecimal(value);
  const shift = exponent + decimals;
  return shift >= 0 ? mantissa * 10n ** BigInt(shift) : mantissa / 10n ** BigInt(-shift);
}

/** Subtracted exactly and then floored, so dust in either value never adds room. */
function trustlineRoom(limit: string, balance: string, decimals: number): bigint {
  const parsedLimit = parseXrplDecimal(limit);
  const parsedBalance = parseXrplDecimal(balance);
  const exponent = Math.min(parsedLimit.exponent, parsedBalance.exponent);
  const room =
    parsedLimit.mantissa * 10n ** BigInt(parsedLimit.exponent - exponent) -
    parsedBalance.mantissa * 10n ** BigInt(parsedBalance.exponent - exponent);
  const shift = exponent + decimals;
  if (shift >= 0) return room * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  return room / divisor - (room < 0n && room % divisor !== 0n ? 1n : 0n);
}

function parseXrplDecimal(value: string): { mantissa: bigint; exponent: number } {
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d{1,3}))?$/i.exec(value);
  const [, sign = '', whole = '', frac = '', exponent = '0'] = match ?? [];
  if (!match || (whole === '' && frac === '')) throw new Error(`[XrpSpokeService] unreadable XRPL amount: ${value}`);
  const digits = BigInt(`${whole}${frac}` || '0');
  return { mantissa: sign === '-' ? -digits : digits, exponent: Number(exponent) - frac.length };
}
