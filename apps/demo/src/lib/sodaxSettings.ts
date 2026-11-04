import { DEFAULT_API_BASE_URL, type Address, type HttpUrl } from '@sodax/dapp-kit';
import { readJson, writeJson } from './storage';

// Persisted "Sodax Settings" overrides (the header modal). `null` = unset — the effective
// value falls back to the env solver config, a VITE_* var, or the SDK packaged default.
export type SodaxSettings = {
  /** null = Auto: backend submit-tx on, except off on Staging (see gh-401). */
  swapUseBackendSubmitTx: boolean | null;
  /** null = Auto: bridge backend submit-tx follows the SDK default (on). */
  bridgeUseBackendSubmitTx: boolean | null;
  /** null = Auto: same rule as swap, not bridge — a vault swap is filled by the solver, and the
   *  backend route posts to the production API, so Auto is off on Staging (see gh-401). */
  leverageYieldUseBackendSubmitTx: boolean | null;
  solverApiEndpoint: HttpUrl | null;
  intentsContract: Address | null;
  protocolIntentsContract: Address | null;
  /** Gateway root incl. version prefix → `api.baseApiConfig.baseURL`. */
  apiBaseUrl: HttpUrl | null;
  swapsApiBaseUrl: HttpUrl | null;
  /** Per-call base URL for the Bridge API showcase page. */
  bridgeApiBaseUrl: HttpUrl | null;
  /** Per-call base URL for the Leverage Yield API showcase page. */
  leverageYieldApiBaseUrl: HttpUrl | null;
  /** Per-action `x-api-key` for the Leverage Yield page's vault swap (`extras.apiKey`). Keys the
   *  backend submit-tx legs of that one action only, over the instance key below. */
  leverageYieldApiKey: string | null;
  /** Instance-wide `x-api-key` → `SodaxOptions.apiKey`. */
  apiKey: string | null;
  relayerApiEndpoint: HttpUrl | null;
  /** Global `SodaxOptions.fee` recipient. Applies to SDK flows only — the Swaps/Bridge API pages
   *  send their own per-request fee and ignore SDK config. Set together with `partnerFeeBps`. */
  partnerFeeAddress: Address | null;
  /** Fee in basis points (100 = 1%), capped by the SDK at `FEE_PERCENTAGE_SCALE` (10000 = 100%). */
  partnerFeeBps: number | null;
};

export const DEFAULT_SODAX_SETTINGS: SodaxSettings = {
  swapUseBackendSubmitTx: null,
  bridgeUseBackendSubmitTx: null,
  leverageYieldUseBackendSubmitTx: null,
  solverApiEndpoint: null,
  intentsContract: null,
  protocolIntentsContract: null,
  apiBaseUrl: null,
  swapsApiBaseUrl: null,
  bridgeApiBaseUrl: null,
  leverageYieldApiBaseUrl: null,
  leverageYieldApiKey: null,
  apiKey: null,
  relayerApiEndpoint: null,
  partnerFeeAddress: null,
  partnerFeeBps: null,
};

/** The SDK's own bound (`FEE_PERCENTAGE_SCALE`); the backend swaps/bridge APIs cap far lower. */
export const MAX_PARTNER_FEE_BPS = 10000;

/** `/bridge/*` bound: `PartnerFeeV2` mirrors the SDK's `PartnerFeePercentage`, documented as
 *  "Maximum allowed is 100 (1%)". `/swaps/*` states no cap, so it keeps the SDK-wide bound. */
export const BRIDGE_API_MAX_PARTNER_FEE_BPS = 100;

const STORAGE_KEY = 'sodax-demo:sodax-settings';

export function isHttpUrl(value: unknown): value is HttpUrl {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
}

export function isEvmAddress(value: unknown): value is Address {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

// A fee needs a rate: 0 bps with an address would override a route's configured fee with nothing.
export function isFeeBps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PARTNER_FEE_BPS;
}

/** The fee is entered as a percent but stored and sent as basis points, so 0.01% (1 bp) is the
 *  smallest expressible step: `calculatePercentageFeeAmount` does `BigInt(percentage)`, which
 *  throws on a fractional bp rather than rounding it. */
export const MAX_PARTNER_FEE_PERCENT = MAX_PARTNER_FEE_BPS / 100;

// Plain decimal only — `Number` also accepts '1e-3' and '0x10', which carry no '.' and so slip
// past the decimal-place check to round into a different fee than was typed.
const PERCENT_TEXT = /^\d*\.?\d+$/;

function percentDecimals(text: string): number {
  return text.split('.')[1]?.length ?? 0;
}

export function percentTextToBps(text: string): number | null {
  const trimmed = text.trim();
  if (!PERCENT_TEXT.test(trimmed) || percentDecimals(trimmed) > 2) return null;
  const bps = Math.round(Number(trimmed) * 100);
  return isFeeBps(bps) ? bps : null;
}

export function bpsToPercentText(bps: number): string {
  return String(bps / 100);
}

/** `undefined` when the text is empty (unset) or a valid percent. `maxBps` narrows the bound for
 *  a route that caps below the SDK's own (see {@link BRIDGE_API_MAX_PARTNER_FEE_BPS}). */
export function partnerFeePercentError(text: string, maxBps: number = MAX_PARTNER_FEE_BPS): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!PERCENT_TEXT.test(trimmed)) return 'Must be a plain percentage, e.g. 0.1';
  if (percentDecimals(trimmed) > 2) return 'Smallest step is 0.01% (1 bp)';
  const bps = Math.round(Number(trimmed) * 100);
  if (bps === 0) return 'Must be greater than 0%';
  if (bps > maxBps) return `Max ${maxBps / 100}%`;
  return undefined;
}

/** A set-but-empty env var means "unset" — matching how the SDK treats an empty key or base URL. */
export function nonEmptyEnv(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// The env stays a plain string here — importing the store's enum would create a module cycle.
// `useBackendSubmitTx` is the pre-split storage key for swap submit-tx; keep reading it.
type StoredPayload = { solverEnvironment?: unknown; useBackendSubmitTx?: unknown } & Partial<
  Record<keyof SodaxSettings, unknown>
>;

/** Field-by-field sanitize: an invalid or missing stored value loads as `null` (unset). */
export function loadSodaxSettings(): SodaxSettings {
  const raw = readJson<StoredPayload>(STORAGE_KEY);
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SODAX_SETTINGS };
  }
  const legacySwapSubmitTx = raw.swapUseBackendSubmitTx ?? raw.useBackendSubmitTx;
  return {
    swapUseBackendSubmitTx: typeof legacySwapSubmitTx === 'boolean' ? legacySwapSubmitTx : null,
    bridgeUseBackendSubmitTx: typeof raw.bridgeUseBackendSubmitTx === 'boolean' ? raw.bridgeUseBackendSubmitTx : null,
    // No legacy storage key to honour — leverage yield never had one.
    leverageYieldUseBackendSubmitTx:
      typeof raw.leverageYieldUseBackendSubmitTx === 'boolean' ? raw.leverageYieldUseBackendSubmitTx : null,
    solverApiEndpoint: isHttpUrl(raw.solverApiEndpoint) ? raw.solverApiEndpoint : null,
    intentsContract: isEvmAddress(raw.intentsContract) ? raw.intentsContract : null,
    protocolIntentsContract: isEvmAddress(raw.protocolIntentsContract) ? raw.protocolIntentsContract : null,
    apiBaseUrl: isHttpUrl(raw.apiBaseUrl) ? raw.apiBaseUrl : null,
    swapsApiBaseUrl: isHttpUrl(raw.swapsApiBaseUrl) ? raw.swapsApiBaseUrl : null,
    bridgeApiBaseUrl: isHttpUrl(raw.bridgeApiBaseUrl) ? raw.bridgeApiBaseUrl : null,
    leverageYieldApiBaseUrl: isHttpUrl(raw.leverageYieldApiBaseUrl) ? raw.leverageYieldApiBaseUrl : null,
    leverageYieldApiKey: nonEmptyEnv(raw.leverageYieldApiKey) ? raw.leverageYieldApiKey : null,
    apiKey: nonEmptyEnv(raw.apiKey) ? raw.apiKey : null,
    relayerApiEndpoint: isHttpUrl(raw.relayerApiEndpoint) ? raw.relayerApiEndpoint : null,
    partnerFeeAddress: isEvmAddress(raw.partnerFeeAddress) ? raw.partnerFeeAddress : null,
    partnerFeeBps: isFeeBps(raw.partnerFeeBps) ? raw.partnerFeeBps : null,
  };
}

export function loadStoredSolverEnv(): 'Production' | 'Staging' {
  const raw = readJson<StoredPayload>(STORAGE_KEY);
  return raw?.solverEnvironment === 'Staging' ? 'Staging' : 'Production';
}

export function saveSodaxSettings(solverEnvironment: string, settings: SodaxSettings): void {
  writeJson(STORAGE_KEY, { solverEnvironment, ...settings });
}

/** True when any field overrides its default — drives the header badge dot. */
export function hasActiveOverrides(settings: SodaxSettings): boolean {
  return Object.values(settings).some(value => value !== null);
}

// Env defaults shared by the provider and the modal's prefilled values. Base URLs include any
// version prefix (a local swaps-api mounting at the bare origin is `http://localhost:3008`).
const swapsApiBaseUrlEnv: unknown = import.meta.env.VITE_SWAPS_API_BASE_URL;
export const envSwapsApiBaseUrl: HttpUrl | undefined = isHttpUrl(swapsApiBaseUrlEnv) ? swapsApiBaseUrlEnv : undefined;

export const DEFAULT_BRIDGE_API_BASE_URL = 'https://canary-api.sodax.com/v1' as HttpUrl;
const bridgeApiBaseUrlEnv: unknown = import.meta.env.VITE_BRIDGE_API_BASE_URL;
export const envBridgeApiBaseUrl: HttpUrl | undefined = isHttpUrl(bridgeApiBaseUrlEnv)
  ? bridgeApiBaseUrlEnv
  : undefined;

const leverageYieldApiBaseUrlEnv: unknown = import.meta.env.VITE_LEVERAGE_YIELD_API_BASE_URL;
export const envLeverageYieldApiBaseUrl: HttpUrl | undefined = isHttpUrl(leverageYieldApiBaseUrlEnv)
  ? leverageYieldApiBaseUrlEnv
  : undefined;

// Instance-wide SODAX API key: `x-api-key` on every backend call, sponsoring included while it
// targets the packaged gateway (VITE_SPONSORING_API_KEY is only for an independently hosted one).
const sodaxApiKeyEnv: unknown = import.meta.env.VITE_SODAX_API_KEY;
export const envSodaxApiKey: string | undefined = nonEmptyEnv(sodaxApiKeyEnv) ? sodaxApiKeyEnv : undefined;

/**
 * The swaps base URL the SDK actually resolves for the demo, mirroring `layerConfigs` precedence:
 * `swapsApiConfig` > `baseApiConfig` > packaged default. Shared by the provider and the Swaps API
 * page's direct client so submission and status polling cannot target different deployments.
 */
export function effectiveSwapsApiBaseUrl(settings: SodaxSettings): HttpUrl {
  return settings.swapsApiBaseUrl ?? envSwapsApiBaseUrl ?? settings.apiBaseUrl ?? DEFAULT_API_BASE_URL;
}

/**
 * The Leverage Yield API host the showcase page calls, same precedence as the swaps one. The scheme
 * is required: `makeRequest` concatenates `baseURL + endpoint` for `fetch`, so a bare `host:port`
 * parses as an unknown scheme rather than a host. The value is the gateway ROOT — the SDK appends
 * `/leverage-yield/*` itself (a local leverage-yield API mounts them at the bare origin).
 */
export function effectiveLeverageYieldApiBaseUrl(settings: SodaxSettings): HttpUrl {
  return settings.leverageYieldApiBaseUrl ?? envLeverageYieldApiBaseUrl ?? settings.apiBaseUrl ?? DEFAULT_API_BASE_URL;
}

/** The `x-api-key` the SDK sends, so a direct client authenticates with the same credential. */
export function effectiveSodaxApiKey(settings: SodaxSettings): string | undefined {
  return settings.apiKey ?? envSodaxApiKey;
}
