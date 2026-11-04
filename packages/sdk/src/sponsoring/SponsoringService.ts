import { ChainKeys, type IStellarWalletProvider, type Result, type StellarSponsorConfig } from '@sodax/types';
import type { Horizon } from '@stellar/stellar-sdk';

import type { BackendApiService } from '../backendApi/BackendApiService.js';
import { apiKeyHeader, mergeHeaders, type RequestOverrideConfig } from '../backendApi/api-utils.js';
import type { ConfigService } from '../shared/config/ConfigService.js';
import type { SpokeService } from '../shared/services/spoke/SpokeService.js';
import { isSodaxError, SodaxError } from '../errors/SodaxError.js';
import { sleep } from '../shared/utils/shared-utils.js';
import { intentCreationFailed, lookupFailed, messageOf, unknownFailed } from '../errors/wrappers.js';
import {
  classifySponsorError,
  type SponsoringConfigError,
  type SponsoringLookupError,
  type SponsoringOrchestrationError,
} from './errors.js';
import {
  assertSignedByAccount,
  assertSponsoredCreateInputs,
  buildSponsoredCreate,
} from './internal/stellarSponsoredCreate.js';
import {
  isHorizonNotFound,
  parseBaseReserveStroops,
  readReserveInfo,
  STELLAR_BASE_RESERVE_STROOPS,
} from './internal/horizon.js';

/**
 * Mirrors the server's config cache window so sponsor rotation propagates
 * within one minute.
 */
export const SPONSOR_CONFIG_TTL_MS = 60_000;

/**
 * The base reserve only moves at a network upgrade, so one read per hour is
 * ample and keeps account-status polling to a single request.
 */
export const STELLAR_BASE_RESERVE_TTL_MS = 3_600_000;

const DEFAULT_MAX_HORIZON_RETRIES = 2;

/** 0.01 XLM reserved for transaction fees and surge pricing. */
const STELLAR_FEE_HEADROOM_STROOPS = 100_000n;

/**
 * Spendable XLM required for one trustline at the base reserve Stellar has
 * published since protocol 12. It is the fallback only: the live requirement
 * is `StellarAccountStatus.trustlineMinXlmStroops`, computed from the network's
 * current base reserve, which validators can vote to change.
 */
export const STELLAR_TRUSTLINE_MIN_XLM_STROOPS = STELLAR_BASE_RESERVE_STROOPS + STELLAR_FEE_HEADROOM_STROOPS;

export type StellarAccountStatus = {
  exists: boolean;
  /** Total native XLM in stroops; `0n` when the account does not exist. */
  nativeBalanceStroops: bigint;
  /** Total minus locked reserves and selling liabilities. */
  availableBalanceStroops: bigint;
  /** Whether available balance can fund one additional trustline. */
  canAffordTrustline: boolean;
  /**
   * Spendable XLM one more trustline needs, at the network's current base
   * reserve. Render this rather than {@link STELLAR_TRUSTLINE_MIN_XLM_STROOPS}.
   */
  trustlineMinXlmStroops: bigint;
};

export type ActivateStellarAccountParams = {
  /** Stellar account to activate. Must be the account `walletProvider` signs with. */
  address: string;
  /**
   * Signs as the account being created. The SDK must not broadcast before the
   * server adds the sponsor signature.
   */
  walletProvider: IStellarWalletProvider;
  /**
   * Allow one rebuild and new signature after a sequence conflict. Defaults to
   * `true`; disable for headless callers.
   */
  allowSequenceRetry?: boolean;
  /**
   * Re-submit the same signed payload after `HORIZON_UNAVAILABLE`.
   * Defaults to 2; `0` disables.
   */
  maxHorizonRetries?: number;
  /**
   * Fired before each wallet prompt so a UI can explain a required re-sign
   * before the extension takes focus.
   */
  onSignatureRequired?: (info: { attempt: 1 | 2; reason: 'initial' | 'sequenceConflict' }) => void;
  forceConfigRefresh?: boolean;
  requestConfig?: RequestOverrideConfig;
};

export type ActivateStellarAccountResult =
  | {
      status: 'submitted';
      hash: string;
      /** Number of wallet signatures; `2` means a sequence conflict was retried. */
      attempts: 1 | 2;
    }
  | {
      /** No transaction was needed; `attempts: 0` means no wallet prompt. */
      status: 'alreadyActive';
      hash: null;
      attempts: 0 | 1 | 2;
    };

type ConfigCacheEntry = { value: StellarSponsorConfig; expiresAt: number };

/**
 * Orchestrates sponsored Stellar activation: config caching, Horizon reads,
 * account signing, sponsor submission, and bounded retries.
 */
export class SponsoringService {
  private readonly config: ConfigService;
  private readonly spoke: SpokeService;
  private readonly api: BackendApiService;

  /** Keyed by base URL to isolate deployment-specific sponsor config. */
  private readonly configCache = new Map<string, ConfigCacheEntry>();
  private readonly inflightConfig = new Map<string, Promise<Result<StellarSponsorConfig, SponsoringConfigError>>>();

  private baseReserveCache: { value: bigint; expiresAt: number } | undefined;
  private inflightBaseReserve: Promise<bigint> | undefined;

  constructor(deps: { config: ConfigService; spoke: SpokeService; api: BackendApiService }) {
    this.config = deps.config;
    this.spoke = deps.spoke;
    this.api = deps.api;
  }

  private get horizon(): Horizon.Server {
    return this.spoke.stellar.server;
  }

  /**
   * Whether an account exists. Read failures remain errors rather than being
   * misreported as inactive.
   */
  public async isStellarAccountActive(params: { address: string }): Promise<Result<boolean, SponsoringLookupError>> {
    const account = await this.readAccount(params.address, 'isStellarAccountActive');
    return account.ok ? { ok: true, value: account.value !== undefined } : account;
  }

  /**
   * Return account existence and trustline affordability. Costs one Horizon
   * account read, plus a base-reserve read on the first call per hour.
   */
  public async getStellarAccountStatus(params: {
    address: string;
  }): Promise<Result<StellarAccountStatus, SponsoringLookupError>> {
    const account = await this.readAccount(params.address, 'getStellarAccountStatus');
    if (!account.ok) return account;

    const baseReserveStroops = await this.resolveBaseReserveStroops();
    const trustlineMinXlmStroops = baseReserveStroops + STELLAR_FEE_HEADROOM_STROOPS;

    if (account.value === undefined) {
      return {
        ok: true,
        value: {
          exists: false,
          nativeBalanceStroops: 0n,
          availableBalanceStroops: 0n,
          canAffordTrustline: false,
          trustlineMinXlmStroops,
        },
      };
    }

    const { nativeBalanceStroops, availableBalanceStroops } = readReserveInfo(account.value, baseReserveStroops);
    return {
      ok: true,
      value: {
        exists: true,
        nativeBalanceStroops,
        availableBalanceStroops,
        canAffordTrustline: availableBalanceStroops >= trustlineMinXlmStroops,
        trustlineMinXlmStroops,
      },
    };
  }

  /**
   * Shared account read. A 404 resolves to `undefined` because absence is a
   * legitimate answer; every other failure remains an error.
   */
  private async readAccount(
    address: string,
    action: 'isStellarAccountActive' | 'getStellarAccountStatus',
  ): Promise<Result<Awaited<ReturnType<Horizon.Server['loadAccount']>> | undefined, SponsoringLookupError>> {
    if (address.length === 0) {
      return {
        ok: false,
        error: new SodaxError('VALIDATION_FAILED', 'address is required', {
          feature: 'sponsoring',
          context: { phase: 'validate', method: action, field: 'address' },
        }),
      };
    }
    try {
      return { ok: true, value: await this.horizon.loadAccount(address) };
    } catch (error) {
      if (isHorizonNotFound(error)) return { ok: true, value: undefined };
      return {
        ok: false,
        error: lookupFailed('sponsoring', action, error, { srcChainKey: ChainKeys.STELLAR_MAINNET }),
      };
    }
  }

  /**
   * The base reserve is a validator-controlled network setting, so read it from
   * the latest ledger rather than assuming the published 0.5 XLM. A failed read
   * degrades to that value: this drives a UI hint, never a signed transaction.
   */
  private async resolveBaseReserveStroops(): Promise<bigint> {
    const cached = this.baseReserveCache;
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const inflight = this.inflightBaseReserve;
    if (inflight) return inflight;

    const read = async (): Promise<bigint> => {
      try {
        const page = await this.horizon.ledgers().order('desc').limit(1).call();
        const value = parseBaseReserveStroops(page.records[0]);
        if (value !== undefined) return value;
      } catch (error) {
        this.config.logger.warn('[SponsoringService] Stellar base-reserve read failed; assuming the published value', {
          reason: messageOf(error, String(error)),
        });
      }
      return STELLAR_BASE_RESERVE_STROOPS;
    };

    const request = read()
      .then(value => {
        // Cache the fallback too, so a failing ledger endpoint cannot double every poll.
        this.baseReserveCache = { value, expiresAt: Date.now() + STELLAR_BASE_RESERVE_TTL_MS };
        return value;
      })
      .finally(() => {
        if (this.inflightBaseReserve === request) this.inflightBaseReserve = undefined;
      });

    this.inflightBaseReserve = request;
    return request;
  }

  /**
   * Cache key for a config request: the resolved base URL plus the per-call headers the request will
   * actually carry, `apiKey` included. Headers can select a different response from the same URL — an
   * API key scoped to another deployment, or a test harness's scenario header — so folding them in
   * stops one caller's override from being served to, or overwriting, the default path. Names are
   * lower-cased before sorting and serialized as JSON so casing and delimiters cannot collide two
   * distinct header sets onto one key. Kept in memory as a Map key only.
   */
  private configCacheKey(requestConfig?: RequestOverrideConfig): string {
    const baseURL = requestConfig?.baseURL || this.api.sponsoring.getBaseURL();
    const headers = mergeHeaders(apiKeyHeader(requestConfig?.apiKey), requestConfig?.headers);
    const entries = Object.entries(headers)
      .map(([name, value]): [string, string] => [name.toLowerCase(), value])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return entries.length === 0 ? baseURL : `${baseURL}|${JSON.stringify(entries)}`;
  }

  /**
   * Fetch sponsor config with per-endpoint caching and in-flight deduplication.
   * Failures are never cached.
   */
  public async getStellarSponsorConfig(params?: {
    forceRefresh?: boolean;
    requestConfig?: RequestOverrideConfig;
  }): Promise<Result<StellarSponsorConfig, SponsoringConfigError>> {
    const key = this.configCacheKey(params?.requestConfig);

    if (params?.forceRefresh) {
      // Do not join a stale in-flight request during a forced refresh.
      this.configCache.delete(key);
      this.inflightConfig.delete(key);
    } else {
      const cached = this.configCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return { ok: true, value: cached.value };
      const inflight = this.inflightConfig.get(key);
      if (inflight) return inflight;
    }

    const request = this.api.sponsoring
      .getStellarSponsorConfig(params?.requestConfig)
      .then((result): Result<StellarSponsorConfig, SponsoringConfigError> => {
        // A superseded request must not overwrite the refreshed value.
        if (result.ok && this.inflightConfig.get(key) === request) {
          // Header-scoped keys are unbounded (a caller may send a per-request trace
          // header), so drop expired entries rather than accumulating one per call.
          const now = Date.now();
          for (const [cached, entry] of this.configCache) {
            if (entry.expiresAt <= now) this.configCache.delete(cached);
          }
          this.configCache.set(key, { value: result.value, expiresAt: now + SPONSOR_CONFIG_TTL_MS });
        }
        return result;
      })
      .finally(() => {
        // Preserve a replacement request registered by a concurrent refresh.
        if (this.inflightConfig.get(key) === request) this.inflightConfig.delete(key);
      });

    this.inflightConfig.set(key, request);
    return request;
  }

  /**
   * Activate an account with a sponsored base reserve. Config and existence are
   * checked before prompting; sponsor sequence is never cached.
   */
  public async activateStellarAccount(
    params: ActivateStellarAccountParams,
  ): Promise<Result<ActivateStellarAccountResult, SponsoringOrchestrationError>> {
    // Analytics needs the active attempt even when failure occurs before submit.
    let attempts: 0 | 1 | 2 = 0;

    return this.config.analytics.trackResult(
      'sponsoring',
      'activateStellarAccount',
      async (): Promise<Result<ActivateStellarAccountResult, SponsoringOrchestrationError>> => {
        try {
          const { address } = params;

          const configResult = await this.getStellarSponsorConfig({
            forceRefresh: params.forceConfigRefresh,
            requestConfig: params.requestConfig,
          });
          if (!configResult.ok) return configResult;
          const sponsorConfig = configResult.value;

          if (await this.accountExistsBestEffort(address)) {
            return { ok: true, value: { status: 'alreadyActive', hash: null, attempts: 0 } };
          }

          attempts = 1;
          const first = await this.attemptActivation({ params, sponsorConfig, attempt: 1 });
          // Only a sequence conflict warrants one additional signature.
          if (first.ok || params.allowSequenceRetry === false) return first;
          if (first.error.context?.nextAction !== 'rebuildAndResign') return first;

          // A server sequence hint avoids another Horizon read but remains advisory.
          attempts = 2;
          return this.attemptActivation({
            params,
            sponsorConfig,
            attempt: 2,
            sponsorSequenceHint: first.error.context?.sponsorSequence,
          });
        } catch (error) {
          if (isSodaxError(error)) {
            return { ok: false, error: error as SponsoringOrchestrationError };
          }
          return {
            ok: false,
            error: unknownFailed('sponsoring', error, { action: 'activateStellarAccount' }),
          };
        }
      },
      {
        start: () => ({ srcChainKey: ChainKeys.STELLAR_MAINNET, address: params.address }),
        success: value => ({ status: value.status, attempts: value.attempts, hash: value.hash }),
        failure: error => ({
          code: error.code,
          // Preserve evidence that a sequence-conflict retry occurred.
          attempts,
          // `status` is already the domain outcome in success events.
          httpStatus: error.context?.status,
          nextAction: error.context?.nextAction,
        }),
      },
    );
  }

  /** One build, sign, and submit attempt. */
  private async attemptActivation(args: {
    params: ActivateStellarAccountParams;
    sponsorConfig: StellarSponsorConfig;
    attempt: 1 | 2;
    /** Sequence supplied by a prior conflict. */
    sponsorSequenceHint?: string;
  }): Promise<Result<ActivateStellarAccountResult, SponsoringOrchestrationError>> {
    const { params, sponsorConfig, attempt, sponsorSequenceHint } = args;
    const { address, walletProvider } = params;

    // Reject a bad published config before spending a Horizon round-trip on the
    // sponsor's sequence — an invalid sponsorAccount would otherwise surface as
    // that lookup's 404 rather than as the validation failure it is.
    assertSponsoredCreateInputs({ config: sponsorConfig, address });

    // Read per attempt unless the server supplied a conflict hint.
    let sponsorSequence: string;
    if (sponsorSequenceHint !== undefined) {
      sponsorSequence = sponsorSequenceHint;
    } else {
      try {
        const sponsorAccount = await this.horizon.loadAccount(sponsorConfig.sponsorAccount);
        sponsorSequence = sponsorAccount.sequenceNumber();
      } catch (error) {
        return {
          ok: false,
          error: lookupFailed('sponsoring', 'loadSponsorAccount', error, {
            action: 'activateStellarAccount',
            srcChainKey: ChainKeys.STELLAR_MAINNET,
          }),
        };
      }
    }

    const transaction = buildSponsoredCreate({ config: sponsorConfig, sponsorSequence, address });
    const unsignedHash = transaction.hash();

    params.onSignatureRequired?.({ attempt, reason: attempt === 1 ? 'initial' : 'sequenceConflict' });

    let signedXdr: string;
    try {
      // The account being created signs even though the sponsor is transaction source.
      signedXdr = await walletProvider.signTransaction(transaction.toXDR(), { address });
    } catch (error) {
      return {
        ok: false,
        error: intentCreationFailed('sponsoring', error, {
          action: 'activateStellarAccount',
          srcChainKey: ChainKeys.STELLAR_MAINNET,
        }),
      };
    }

    // Convert wrong-network, wrong-key, and mutated envelopes into local errors.
    assertSignedByAccount({ signedXdr, address, unsignedHash });

    const submitted = await this.submitWithHorizonRetry({
      signedXdr,
      maxRetries: params.maxHorizonRetries ?? DEFAULT_MAX_HORIZON_RETRIES,
      requestConfig: params.requestConfig,
    });

    if (submitted.ok) {
      const response = submitted.value;
      return response.alreadyActive
        ? { ok: true, value: { status: 'alreadyActive', hash: null, attempts: attempt } }
        : { ok: true, value: { status: 'submitted', hash: response.hash, attempts: attempt } };
    }

    const classification = classifySponsorError(submitted.error);

    // Evict potentially rotated config, but do not hide integration bugs with a retry.
    if (classification.action === 'fixIntegration') {
      this.configCache.delete(this.configCacheKey(params.requestConfig));
    }

    return {
      ok: false,
      error: new SodaxError('EXTERNAL_API_ERROR', classification.message, {
        feature: 'sponsoring',
        cause: submitted.error,
        context: {
          api: 'sponsoring',
          action: 'activateStellarAccount',
          phase: 'submit',
          srcChainKey: ChainKeys.STELLAR_MAINNET,
          attempts: attempt,
          nextAction: classification.action,
          retryable: classification.retryable,
          requiresNewSignature: classification.requiresNewSignature,
          sponsorAccount: sponsorConfig.sponsorAccount,
          status: classification.status,
          code: classification.code,
          retryAfterSeconds: classification.retryAfterSeconds,
          sponsorSequence: classification.sponsorSequence,
        },
      }),
    };
  }

  /**
   * Re-submit identical signed bytes only for `retrySameRequest` failures.
   */
  private async submitWithHorizonRetry(args: {
    signedXdr: string;
    maxRetries: number;
    requestConfig?: RequestOverrideConfig;
  }): ReturnType<BackendApiService['sponsoring']['createStellarSponsoredAccount']> {
    const { signedXdr, maxRetries, requestConfig } = args;
    let result = await this.api.sponsoring.createStellarSponsoredAccount({ data: signedXdr }, requestConfig);

    for (let retry = 0; retry < maxRetries && !result.ok; retry++) {
      if (classifySponsorError(result.error).action !== 'retrySameRequest') break;
      await sleep(1000 * (retry + 1));
      result = await this.api.sponsoring.createStellarSponsoredAccount({ data: signedXdr }, requestConfig);
    }
    return result;
  }

  /**
   * Best-effort existence pre-flight. Read failures continue to activation
   * because the server performs the authoritative check.
   */
  private async accountExistsBestEffort(address: string): Promise<boolean> {
    const account = await this.readAccount(address, 'isStellarAccountActive');
    if (account.ok) return account.value !== undefined;
    this.config.logger.warn(
      '[SponsoringService] Stellar account existence pre-flight failed; continuing with activation',
      { address, reason: messageOf(account.error, String(account.error)) },
    );
    return false;
  }
}
