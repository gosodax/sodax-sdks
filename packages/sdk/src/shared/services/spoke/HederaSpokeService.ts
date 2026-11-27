import { encodeFunctionData, isAddress, parseAbi, type Address } from 'viem';
import {
  ChainKeys,
  IndeterminateOutcomeError,
  type EvmRawTransaction,
  type HederaChainKey,
  type HederaSpokeChainConfig,
  type Hex,
  type Result,
  type WalletProviderSlot,
} from '@sodax/types';
import type { ConfigService } from '../../config/ConfigService.js';
import { getEvmViemChain } from '../../utils/constant-utils.js';
import { pollUntil } from '../../utils/pollUntil.js';
import type { EvmSpokeService } from './EvmSpokeService.js';

/** Hedera's public mainnet mirror node, used when the chain config names none. */
export const HEDERA_DEFAULT_MIRROR_NODE_URL = 'https://mainnet-public.mirrornode.hedera.com';

/** Per-request budget for a mirror-node read. */
const MIRROR_TIMEOUT_MS = 15_000;

/** How long `requestAssociation` waits for the mirror node to show an association that landed on-chain. */
const MIRROR_SYNC_TIMEOUT_MS = 30_000;
const MIRROR_SYNC_INTERVAL_MS = 2_000;

/** HIP-719: every HTS token answers `associate()` at its own address, for `msg.sender` and that token only. */
const hip719Abi = parseAbi(['function associate() returns (uint256)']);

/**
 * Whether a Hedera account can receive an HTS token from a release, and if not, why. Only an existing
 * association counts: an automatic association during delivery, or creating the account, costs more gas
 * than the relay's delivery execution provides, so free or unlimited automatic slots do not make it ready.
 */
export type HederaDestinationReadiness =
  | { ready: true }
  | { ready: false; reason: 'account_missing' | 'not_associated' | 'frozen' | 'kyc_not_granted' };

/** Associate exactly `token` with `srcAddress`, which signs. */
export type RequestHederaAssociationParams<Raw extends boolean> = {
  srcAddress: Address;
  token: string;
} & WalletProviderSlot<HederaChainKey, Raw>;

/** The unsigned `associate()` call in raw mode, else the hash of the mined association. */
export type RequestHederaAssociationReturnType<Raw extends boolean> = Raw extends true ? EvmRawTransaction : Hex;

type MirrorTokenRelationship = { tokenId: string; freezeStatus: unknown; kycStatus: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRelationships(body: unknown): MirrorTokenRelationship[] {
  const tokens = isRecord(body) && Array.isArray(body.tokens) ? body.tokens : [];
  return tokens.flatMap(t =>
    isRecord(t) && typeof t.token_id === 'string'
      ? [{ tokenId: t.token_id, freezeStatus: t.freeze_status, kycStatus: t.kyc_status }]
      : [],
  );
}

/**
 * The `0.0.N` id of an HTS token from its long-zero EVM address, or `undefined` for any other address
 * (a plain ERC-20 contract, which needs no association).
 */
export function hederaTokenId(address: string): string | undefined {
  if (!isAddress(address, { strict: false })) return undefined;
  const value = BigInt(address);
  if (value === 0n || value >> 64n !== 0n) return undefined;
  return `0.0.${value}`;
}

/**
 * Hedera HTS token associations. Hedera deposits and messages ride the shared {@link EvmSpokeService};
 * this covers what an EVM chain does not have: an account must be associated with an HTS token to hold it.
 */
export class HederaSpokeService {
  private readonly config: ConfigService;
  private readonly evm: EvmSpokeService;

  constructor(config: ConfigService, evm: EvmSpokeService) {
    this.config = config;
    this.evm = evm;
  }

  private get chainConfig(): HederaSpokeChainConfig {
    return this.config.getChainConfig(ChainKeys.HEDERA_MAINNET);
  }

  /** Whether receiving `token` needs an association: every listed HTS token does, native HBAR does not. */
  public requiresAssociation(token: string): boolean {
    return this.findHtsToken(token) !== undefined;
  }

  /**
   * Whether `address` can receive `token` from a release, checked before the hub burns it. HBAR, and any
   * listed token that is not an HTS token, are always ready. An HTS token is ready only for an account
   * already associated with it, not frozen for it, and with KYC granted where the token requires it.
   * Throws on a token outside the Hedera list or a failed mirror-node read.
   */
  public async checkDestination(params: { address: string; token: string }): Promise<HederaDestinationReadiness> {
    const { address, token } = params;
    if (!isAddress(address, { strict: false })) {
      throw new Error(`[HederaSpokeService.checkDestination] invalid Hedera EVM address ${address}`);
    }
    if (!this.isListed(token)) throw new Error(`[HederaSpokeService.checkDestination] unknown Hedera token ${token}`);
    const hts = this.findHtsToken(token);
    if (hts === undefined) return { ready: true };

    const [account, relationships] = await Promise.all([
      this.mirror(`/api/v1/accounts/${address}`),
      this.mirror(`/api/v1/accounts/${address}/tokens?token.id=${hts.id}`),
    ]);
    if (!isRecord(account) || account.deleted === true) return { ready: false, reason: 'account_missing' };

    const relationship = readRelationships(relationships).find(t => t.tokenId === hts.id);
    if (!relationship) return { ready: false, reason: 'not_associated' };
    if (relationship.freezeStatus === 'FROZEN') return { ready: false, reason: 'frozen' };
    if (relationship.kycStatus === 'REVOKED') return { ready: false, reason: 'kyc_not_granted' };
    return { ready: true };
  }

  /**
   * Associate exactly `token` with `srcAddress` by calling HIP-719 `associate()` on the token's own
   * address. The account pays the network fee in HBAR. `raw: true` returns the unsigned call.
   *
   * Otherwise the wallet sends it, and this resolves to its hash once it is mined and the mirror node
   * shows the association (or the wait for the mirror node runs out). A reverted call is a plain failure.
   * A call that was sent but whose receipt never arrived is an IndeterminateOutcomeError carrying the hash:
   * check it before signing again, since each association costs a fee.
   */
  public async requestAssociation<Raw extends boolean>(
    params: RequestHederaAssociationParams<Raw>,
  ): Promise<Result<RequestHederaAssociationReturnType<Raw>>> {
    try {
      const { srcAddress, token } = params;
      const hts = this.findHtsToken(token);
      if (!hts) throw new Error(`[HederaSpokeService.requestAssociation] ${token} is not a listed Hedera HTS token`);
      const tx: EvmRawTransaction = {
        from: srcAddress,
        to: hts.address,
        value: 0n,
        data: encodeFunctionData({ abi: hip719Abi, functionName: 'associate' }),
      };
      if (params.raw === true) {
        return { ok: true, value: tx satisfies EvmRawTransaction as RequestHederaAssociationReturnType<Raw> };
      }

      const hash = await params.walletProvider.sendTransaction(tx, {
        expectedChainId: getEvmViemChain(ChainKeys.HEDERA_MAINNET).id,
      });
      const unknown = (cause: unknown) =>
        new IndeterminateOutcomeError(`[HederaSpokeService.requestAssociation] outcome of ${hash} is unknown`, {
          txHash: hash,
          cause,
        });
      const { pollingIntervalMs, maxTimeoutMs } = this.chainConfig.pollingConfig;
      const receipt = await this.evm.waitForTransactionReceipt({
        chainKey: ChainKeys.HEDERA_MAINNET,
        txHash: hash,
        pollingIntervalMs,
        maxTimeoutMs,
      });
      if (!receipt.ok) throw unknown(receipt.error);
      if (receipt.value.status === 'failure') {
        throw new Error(`[HederaSpokeService.requestAssociation] association ${hash} failed`, {
          cause: receipt.value.error,
        });
      }
      if (receipt.value.status !== 'success') throw unknown(receipt.value.error);

      await this.waitForMirrorAssociation(srcAddress, token);
      return { ok: true, value: hash satisfies Hex as RequestHederaAssociationReturnType<Raw> };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /** The mirror node trails consensus by a few seconds; a check read in that gap would ask to associate again. */
  private async waitForMirrorAssociation(address: string, token: string): Promise<void> {
    await pollUntil(
      async () => {
        const readiness = await this.checkDestination({ address, token }).catch(() => undefined);
        if (readiness === undefined) return undefined;
        return readiness.ready || readiness.reason !== 'not_associated' ? true : undefined;
      },
      { timeoutMs: MIRROR_SYNC_TIMEOUT_MS, intervalMs: MIRROR_SYNC_INTERVAL_MS },
    );
  }

  private isListed(token: string): boolean {
    const lower = token.toLowerCase();
    return (
      lower === this.chainConfig.nativeToken.toLowerCase() ||
      Object.values(this.chainConfig.supportedTokens).some(t => t.address.toLowerCase() === lower)
    );
  }

  /** A listed non-native HTS token, with its `0.0.N` id, or `undefined`. */
  private findHtsToken(token: string): { id: string; address: Address } | undefined {
    if (token.toLowerCase() === this.chainConfig.nativeToken.toLowerCase() || !this.isListed(token)) return undefined;
    const id = hederaTokenId(token);
    return id !== undefined && isAddress(token, { strict: false }) ? { id, address: token } : undefined;
  }

  /** GET a mirror-node path; `undefined` on 404, a throw on any other failure. */
  private async mirror(path: string): Promise<unknown> {
    const base = (this.chainConfig.mirrorNodeUrl ?? HEDERA_DEFAULT_MIRROR_NODE_URL).replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, { signal: controller.signal, headers: { accept: 'application/json' } });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(`hedera mirror node ${path}: HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`hedera mirror node ${path}: timed out after ${MIRROR_TIMEOUT_MS}ms`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
