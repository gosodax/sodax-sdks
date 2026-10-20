import type { HttpUrl, MpcWithdrawScheme, Result } from '@sodax/types';
import type { Hex } from 'viem';
import { invariant } from '../../utils/tiny-invariant.js';

/**
 * Client for the SODAX MPC relay (NEAR chain signatures), used by every chain in `MpcRelayChainMap`.
 * Distinct from the intent relay. Per deposit: getDepositAddress → send the spoke transfer → notify →
 * waitForDeposit.
 */

/**
 * Settlement surface an MPC-relay spoke service implements, so no feature service learns a chain name.
 * An implementation may raise `timeout` to a chain-specific floor, but should not shorten it.
 */
export interface MpcRelaySettlement {
  waitForDeposit(tx: string, timeout?: number): Promise<Result<DepositRecord>>;
  waitForWithdrawal(trackingId: string, timeout?: number): Promise<Result<WithdrawalRecord>>;
}

export type MpcDepositMethod = 'memo' | 'address';

export interface DepositAddressResponse {
  /** Where the user sends funds (shared reserve for memo-mode chains). */
  reserveAddress: string;
  /** 32-byte hash to attach as the transfer memo (memo-mode). */
  memo: Hex;
  /** keccak256(abi.encode(hubWallet, data)) — same value as `memo`. */
  payloadHash: Hex;
  /** MPC derivation path for the deposit. */
  path: string;
  /** Hub-side smart wallet that receives the mint / runs `data`. */
  hubWallet: Hex;
  depositMethod: MpcDepositMethod;
}

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

/** Signed withdraw message as submitted to the ingest (numeric fields are u64 decimal strings). */
export interface WithdrawMessagePayload {
  to: Hex;
  data: Hex;
  nonce: string;
  chainId: string;
  sender: Hex;
}

export interface SubmitWithdrawRequest {
  message: WithdrawMessagePayload;
  signature: Hex;
  scheme: WithdrawScheme;
  /** Required only for schemes that can't recover the identity from the sig (2/3/4). */
  publicKey?: Hex;
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

export async function getDeposit(apiUrl: HttpUrl, depositId: string): Promise<Result<DepositRecord>> {
  invariant(depositId.length > 0, 'Invalid input parameters. depositId empty');
  return getJson<DepositRecord>(`${apiUrl}/deposit/${encodeURIComponent(depositId)}`);
}

export interface WaitForDepositOptions {
  timeout?: number;
  pollIntervalMs?: number;
}

/** Poll until the deposit reaches `minted` (resolve) or `failed` (reject). */
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
    if (res.ok && (res.value.status === 'minted' || res.value.status === 'swept')) return res;
    if (Date.now() >= deadline) {
      return { ok: false, error: new Error(`mpc-relay: timed out waiting for deposit ${depositId}`) };
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

/** Poll until the withdrawal reaches `released` (resolve) or `failed` (reject). */
export async function waitForWithdrawal(
  apiUrl: HttpUrl,
  trackingId: string,
  options: WaitForDepositOptions = {},
): Promise<Result<WithdrawalRecord>> {
  const timeout = options.timeout ?? DEFAULT_DEPOSIT_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  for (;;) {
    // The loop is the retry, as in `waitForDeposit`.
    const res = await getWithdrawal(apiUrl, trackingId);
    if (res.ok) {
      if (res.value.status === 'released') return res;
      if (res.value.status === 'failed') {
        return {
          ok: false,
          error: new Error(`mpc-relay: withdrawal ${trackingId} failed: ${res.value.error ?? 'no reason given'}`),
        };
      }
    }
    if (Date.now() >= deadline) {
      return { ok: false, error: new Error(`mpc-relay: timed out waiting for withdrawal ${trackingId}`) };
    }
    await new Promise(r => setTimeout(r, interval));
  }
}
