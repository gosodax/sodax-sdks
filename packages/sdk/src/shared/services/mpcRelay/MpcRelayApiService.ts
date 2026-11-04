import type { HttpUrl, MpcRelayChainKey, MpcWithdrawMessage, MpcWithdrawScheme, Result } from '@sodax/types';
import { encodeAbiParameters, keccak256, type Hex } from 'viem';
import { invariant } from '../../utils/tiny-invariant.js';
import { RELAY_ERROR_CODES } from '../intentRelay/IntentRelayApiService.js';

/**
 * Client for the SODAX MPC relay (NEAR chain signatures), used by every chain in `MpcRelayChainMap`.
 * Distinct from the intent relay. Per deposit: getDepositAddress → send the spoke transfer → notify →
 * waitForDeposit.
 */

/**
 * Settlement surface an MPC-relay spoke service implements, so no feature service learns a chain name. Each
 * operation has a submit that only notifies, a one-read get, and a wait that polls (and re-notifies, which is
 * idempotent) until it lands. An implementation may raise a wait's `timeout` to a chain floor, never shorten it.
 */
export interface MpcRelaySettlement {
  /** Notify the relay of a broadcast deposit, without waiting for it to land. */
  submitDeposit(tx: string): Promise<Result<void>>;
  getDepositRecord(tx: string): Promise<Result<DepositRecord>>;
  waitForDeposit(tx: string, timeout?: number): Promise<Result<DepositRecord>>;
  /** A withdraw-auth is submitted when signed; this reads its record by the `trackingId` that returned. */
  getWithdrawalRecord(trackingId: string): Promise<Result<WithdrawalRecord>>;
  waitForWithdrawal(
    trackingId: string,
    timeout?: number,
    until?: WithdrawalSettledOn,
  ): Promise<Result<WithdrawalRecord>>;
  /** Notify the relay of a hub tx releasing to this chain, without waiting: the relay does not watch the hub. */
  submitHubRelease(release: HubRelease): Promise<Result<void>>;
  /** One read of a hub release's record, without notifying: a status read must not change anything. */
  getHubReleaseRecord(release: HubRelease): Promise<Result<DepositRecord>>;
  waitForHubRelease(release: HubRelease, timeout?: number): Promise<Result<DepositRecord>>;
}

/**
 * A hub tx's `BridgeRequest` to an MPC-relay chain. The relay keys its release on the hub chain, tx and log
 * index, so re-notifying or reading with the same value always reaches the same release. JSON-safe.
 */
export type HubRelease = { dstChainKey: MpcRelayChainKey; hubChainId: string; hubTxHash: string; logIndex: number };

export type MpcDepositMethod = 'memo' | 'address';

interface DepositAddressBase {
  /** keccak256(abi.encode(hubWallet, data)). */
  payloadHash: Hex;
  /** MPC derivation path for the deposit. */
  path: string;
  /** Hub-side smart wallet that receives the mint / runs `data`. */
  hubWallet: Hex;
}

/** Memo mode (Tron, XRP): pay the shared reserve and tag the transfer with `memo`. */
export interface MemoDepositAddressResponse extends DepositAddressBase {
  depositMethod: 'memo';
  /** The shared reserve the transfer pays. */
  reserveAddress: string;
  /** 32-byte hash to attach as the transfer memo — the same value as `payloadHash`. */
  memo: Hex;
}

/** Address mode (Monad): pay a deposit address derived for this one payload; the relay sweeps it. */
export interface AddressDepositAddressResponse extends DepositAddressBase {
  depositMethod: 'address';
  /** The per-payload deposit address the transfer pays. */
  depositAddress: string;
}

export type DepositAddressResponse = MemoDepositAddressResponse | AddressDepositAddressResponse;

/**
 * Deposit ladder: `pending` → `submitted` → `attested` → `minted` → `swept`. There is no `failed` —
 * a dropped deposit never leaves `pending`, so callers detect failure by timeout.
 */
export type MpcDepositStatus = 'pending' | 'submitted' | 'attested' | 'minted' | 'swept';

export interface DepositRecord {
  depositId: string;
  status: MpcDepositStatus;
  createdAt: number | null;
  txs: {
    source?: { chain: string; hash: string; ts: number };
    nearSubmit?: { chain: string; hash: string; ts: number };
    hubMint?: { chain: string; hash: string; ts: number };
    /** Set on a hub release's record (read through the same route): the spoke payout tx. */
    release?: { chain: string; hash: string; ts: number };
  };
}

export interface NotifyResponse {
  accepted: boolean;
  chain_id?: string;
  tx_hash?: string;
  error?: string;
}

/** Withdraw-auth scheme (per client-api.md §4). Per-chain values live in `MpcRelayChainMap`. */
export type WithdrawScheme = MpcWithdrawScheme;

/** Signed withdraw message as submitted to the ingest. */
export type WithdrawMessagePayload = MpcWithdrawMessage;

export interface SubmitWithdrawRequest {
  message: WithdrawMessagePayload;
  signature: Hex;
  scheme: WithdrawScheme;
  /** Required only for schemes that can't recover the identity from the sig (2/3/4/5). */
  publicKey?: Hex;
  /** The TonConnect `signData` envelope the signature binds — required for scheme 5 (TON). */
  tonSignData?: {
    workchain: number;
    addressHash: Hex;
    domain: string;
    timestamp: number;
    payloadType: 'txt' | 'bin';
  };
}

export interface SubmitWithdrawResponse {
  accepted: boolean;
  /** keccak256(sender ‖ nonce_be8) — the only handle until the burn is mined. */
  trackingId: Hex;
  sender?: Hex;
  nonce?: string;
  hubWallet?: Hex;
  error?: string;
}

/** Withdrawal ladder: `submitted` → `burned` → `attested` → `released`, or `failed` with an `error`. */
export type WithdrawalStatus = 'submitted' | 'burned' | 'attested' | 'released' | 'failed';

/**
 * When a withdraw-auth counts as settled: `released` once the relay pays this chain back, `burned` once
 * the hub tx ran — the end of its leg when the action pays out elsewhere, since nothing is released here.
 */
export type WithdrawalSettledOn = 'released' | 'burned';

export interface WithdrawalRecord {
  trackingId: Hex;
  withdrawalId?: string;
  status: WithdrawalStatus;
  submittedAt?: number;
  /** Present only on `failed` — the coordinator's reason for the terminal rejection. */
  error?: string;
  txs?: {
    submitMessage?: { chain: string; hash: string; ts: number };
    burn?: { chain: string; hash: string; ts: number };
    release?: { chain: string; hash: string; ts: number };
  };
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_DEPOSIT_TIMEOUT_MS = 300_000;

/** Per-request budget, covering the body read: a stalled stream would otherwise hold a poll open. */
const MPC_RELAY_REQUEST_TIMEOUT_MS = 15_000;

async function getJson<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MPC_RELAY_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: new Error(`mpc-relay: ${res.status} non-JSON: ${text.slice(0, 160)}`) };
    }
    if (!res.ok) {
      const err = (json as { error?: string })?.error ?? text.slice(0, 160);
      return { ok: false, error: new Error(`mpc-relay: ${res.status} ${err}`) };
    }
    return { ok: true, value: json as T };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: new Error(`mpc-relay: request timed out after ${MPC_RELAY_REQUEST_TIMEOUT_MS}ms`) };
    }
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/** The payload hash the relay derives for a deposit: `keccak256(abi.encode(hubWallet, data))`. */
export function computePayloadHash(hubWallet: Hex, data: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [hubWallet, data]));
}

/**
 * Register a deposit's hub payload and get back where to send the funds.
 * @param owner  Spoke-chain address; its hub wallet is derived from this.
 * @param srcChain  Numeric spoke chain id as a string.
 * @param data  Hub-side calls, from `encodeContractCalls`. Pass `encodeContractCalls([])` rather than
 *   `'0x'` for a plain mint: only non-empty bytes make the hub deploy the user's wallet.
 */
export async function getDepositAddress(
  apiUrl: HttpUrl,
  owner: string,
  srcChain: string,
  data: Hex,
): Promise<Result<DepositAddressResponse>> {
  invariant(owner.length > 0, 'Invalid input parameters. owner empty');
  invariant(srcChain.length > 0, 'Invalid input parameters. srcChain empty');
  return getJson<DepositAddressResponse>(`${apiUrl}/deposit-address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, srcChain, data }),
  });
}

/**
 * Notify the relay that a tx exists so verifiers attest it. `type` must be omitted for a deposit; it
 * routes to the hub verifier. `txHash` is used verbatim and must match what {@link toDepositId} is given.
 */
export async function notify(
  apiUrl: HttpUrl,
  chainId: string,
  txHash: string,
  type?: 'withdrawal',
): Promise<Result<NotifyResponse>> {
  invariant(chainId.length > 0, 'Invalid input parameters. chainId empty');
  invariant(txHash.length > 0, 'Invalid input parameters. txHash empty');
  const res = await getJson<NotifyResponse>(`${apiUrl}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain_id: chainId, tx_hash: txHash, ...(type ? { type } : {}) }),
  });
  if (res.ok && !res.value.accepted) {
    return { ok: false, error: new Error(`mpc-relay: notify rejected: ${res.value.error ?? 'unknown'}`) };
  }
  return res;
}

/** `${chainId}-${txHash}-${logIndex}`. The hash is used verbatim and must match {@link notify}'s. */
export function toDepositId(chainId: string, txHash: string, logIndex = 0): string {
  return `${chainId}-${txHash}-${logIndex}`;
}

/** A hub release's withdrawal id. The hub verifier lowercases the hash before deriving it. */
export function toHubReleaseId({ hubChainId, hubTxHash, logIndex }: HubRelease): string {
  return toDepositId(hubChainId, hubTxHash.toLowerCase(), logIndex);
}

export async function getDeposit(apiUrl: HttpUrl, depositId: string): Promise<Result<DepositRecord>> {
  invariant(depositId.length > 0, 'Invalid input parameters. depositId empty');
  return getJson<DepositRecord>(`${apiUrl}/deposit/${encodeURIComponent(depositId)}`);
}

/** A wait that ran out, in the intent relay's vocabulary so `mapRelayFailure` reports `RELAY_TIMEOUT`. */
function relayTimeout(detail: string): Error {
  return new Error(RELAY_ERROR_CODES.RELAY_TIMEOUT, { cause: new Error(detail) });
}

export interface WaitForDepositOptions {
  timeout?: number;
  pollIntervalMs?: number;
}

/**
 * Poll until the deposit is `minted` (or `swept` past it) with its hub mint tx recorded. Ends in
 * `RELAY_TIMEOUT`, as the intent relay does, when that does not happen within `timeout`.
 */
export async function waitForDeposit(
  apiUrl: HttpUrl,
  depositId: string,
  options: WaitForDepositOptions = {},
): Promise<Result<DepositRecord>> {
  const timeout = options.timeout ?? DEFAULT_DEPOSIT_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  for (;;) {
    // This loop is the retry: `getDeposit` reports failure in its Result, so `retry` would never fire.
    const res = await getDeposit(apiUrl, depositId);
    // `swept` is past `minted`; waiting only for `minted` would miss a deposit a sweep already passed.
    const minted = res.ok && (res.value.status === 'minted' || res.value.status === 'swept');
    if (minted && res.value.txs?.hubMint?.hash) return res;
    if (Date.now() >= deadline) {
      return { ok: false, error: relayTimeout(`mpc-relay: timed out waiting for deposit ${depositId}`) };
    }
    await new Promise(r => setTimeout(r, interval));
  }
}

/**
 * Poll a hub-triggered release until its spoke payout tx is recorded. `/withdrawal/` only takes a
 * withdraw-auth trackingId, so this reads the release's row by its withdrawalId through `/deposit/`,
 * whose `status` does not track releases; `txs.release` is the signal. Ends in `RELAY_TIMEOUT`.
 */
export async function waitForHubRelease(
  apiUrl: HttpUrl,
  release: HubRelease,
  options: WaitForDepositOptions = {},
): Promise<Result<DepositRecord>> {
  const timeout = options.timeout ?? DEFAULT_DEPOSIT_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;
  const withdrawalId = toHubReleaseId(release);

  for (;;) {
    const res = await getDeposit(apiUrl, withdrawalId);
    if (res.ok && res.value.txs?.release?.hash) return res;
    if (Date.now() >= deadline) {
      return { ok: false, error: relayTimeout(`mpc-relay: timed out waiting for release ${withdrawalId}`) };
    }
    await new Promise(r => setTimeout(r, interval));
  }
}

/**
 * Submit a signed withdraw-auth message (hub→spoke release).
 * @returns the `trackingId` to poll {@link waitForWithdrawal} with.
 */
export async function submitWithdraw(
  apiUrl: HttpUrl,
  request: SubmitWithdrawRequest,
): Promise<Result<SubmitWithdrawResponse>> {
  invariant(request.signature.length > 0, 'Invalid input parameters. signature empty');
  const res = await getJson<SubmitWithdrawResponse>(`${apiUrl}/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (res.ok && !res.value.accepted) {
    return { ok: false, error: new Error(`mpc-relay: withdraw rejected: ${res.value.error ?? 'unknown'}`) };
  }
  return res;
}

export async function getWithdrawal(apiUrl: HttpUrl, trackingId: string): Promise<Result<WithdrawalRecord>> {
  invariant(trackingId.length > 0, 'Invalid input parameters. trackingId empty');
  return getJson<WithdrawalRecord>(`${apiUrl}/withdrawal/${encodeURIComponent(trackingId)}`);
}

/**
 * Poll until the withdrawal reaches `until` (default `released`) with that stage's tx recorded, or
 * `failed` (reject). Ends in `RELAY_TIMEOUT` when neither happens within `timeout`.
 */
export async function waitForWithdrawal(
  apiUrl: HttpUrl,
  trackingId: string,
  options: WaitForDepositOptions & { until?: WithdrawalSettledOn } = {},
): Promise<Result<WithdrawalRecord>> {
  const timeout = options.timeout ?? DEFAULT_DEPOSIT_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  for (;;) {
    // The loop is the retry, as in `waitForDeposit`.
    const res = await getWithdrawal(apiUrl, trackingId);
    if (res.ok) {
      if (res.value.status === 'released' && res.value.txs?.release?.hash) return res;
      // `attested` and `released` are past `burned`, so they settle a `burned` wait too.
      const pastBurn = res.value.status !== 'submitted' && res.value.status !== 'failed';
      if (options.until === 'burned' && pastBurn && res.value.txs?.burn?.hash) return res;
      if (res.value.status === 'failed') {
        return {
          ok: false,
          error: new Error(`mpc-relay: withdrawal ${trackingId} failed: ${res.value.error ?? 'no reason given'}`),
        };
      }
    }
    if (Date.now() >= deadline) {
      return { ok: false, error: relayTimeout(`mpc-relay: timed out waiting for withdrawal ${trackingId}`) };
    }
    await new Promise(r => setTimeout(r, interval));
  }
}
