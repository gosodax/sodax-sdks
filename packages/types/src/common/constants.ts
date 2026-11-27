import { RelayChainIdMap, type IntentChainId, type SpokeChainKey } from '../chains/chains.js';
import type { Address, HttpUrl } from '../shared/shared.js';

export const DEFAULT_MAX_RETRY = 3;
export const DEFAULT_RELAY_TX_TIMEOUT = 120000; // 120 seconds
export const DEFAULT_RETRY_DELAY_MS = 2000;
export const ICON_TX_RESULT_WAIT_MAX_RETRY = 10;
export const MAX_UINT256 = (1n << 256n) - 1n;
export const FEE_PERCENTAGE_SCALE = 10000n; // 100% = 10000
export const DEFAULT_DEADLINE_OFFSET = 300n; // 5 minutes in seconds
/** Gateway root (origin + version prefix) shared by every backend API service; never includes a service segment —
 * each service appends its own (`/be`, `/swaps`, `/bridge`, `/sponsorships/stellar`). */
export const DEFAULT_API_BASE_URL = 'https://api.sodax.com/v1';
/** @deprecated Pass {@link DEFAULT_API_BASE_URL} as `baseURL`; the SDK appends {@link BACKEND_API_BASE_PATH} itself.
 * A `baseURL` ending in `/be` still works, but the SDK trims it and logs a warning. */
export const DEFAULT_BACKEND_API_ENDPOINT = 'https://api.sodax.com/v1/be';
export const DEFAULT_BACKEND_API_TIMEOUT = 30000; // 30 seconds
export const DEFAULT_BACKEND_API_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
export const DEFAULT_RELAYER_API_ENDPOINT = 'https://api.sodax.com/v1/relay';
export const VAULT_TOKEN_DECIMALS = 18;

/** Deliberately not an alias of {@link DEFAULT_API_BASE_URL}: consumers compare against it to decide a target is real
 * mainnet before spending real XLM, so retargeting the shared root must not silently move that guard. */
export const DEFAULT_SPONSORING_API_ENDPOINT = 'https://api.sodax.com/v1';
/** Stellar sponsorship route relative to the configured base URL. */
export const SPONSORING_API_STELLAR_BASE_PATH = '/sponsorships/stellar';
/** Backend data API mount relative to the configured base URL (`/config/*`, `/intent/*`, `/moneymarket/*`, `/solver/*`). */
export const BACKEND_API_BASE_PATH = '/be';

export type BaseApiConfig = {
  baseURL: HttpUrl;
  timeout: number;
  headers: Record<string, string>;
};

/** `basePath` is the mount below `baseURL` (default {@link BACKEND_API_BASE_PATH}); use `''` for a directly addressed
 * service serving `/config/*`, `/intent/*`, … at the bare origin. */
export type BackendApiConfig = BaseApiConfig & { basePath?: string };
export type SwapsApiConfig = BaseApiConfig;

/** `baseURL` includes any deployment prefix; `apiKey` is sent as `x-api-key`. Browser-bundled keys are public. */
export type SponsoringApiConfig = BaseApiConfig & { apiKey?: string };

/** At least one slice is required to keep this union distinct from flat {@link BackendApiConfig}. */
export type CustomApiConfig =
  | { baseApiConfig: BackendApiConfig; swapsApiConfig?: SwapsApiConfig; sponsoringApiConfig?: SponsoringApiConfig }
  | { baseApiConfig?: BackendApiConfig; swapsApiConfig: SwapsApiConfig; sponsoringApiConfig?: SponsoringApiConfig }
  | { baseApiConfig?: BackendApiConfig; swapsApiConfig?: SwapsApiConfig; sponsoringApiConfig: SponsoringApiConfig };

export type ApiConfig = BackendApiConfig | CustomApiConfig;

export const apiConfig = {
  baseURL: DEFAULT_API_BASE_URL,
  timeout: DEFAULT_BACKEND_API_TIMEOUT,
  headers: DEFAULT_BACKEND_API_HEADERS,
} satisfies ApiConfig;

export type SolverConfig = {
  intentsContract: Address; // on the hub
  solverApiEndpoint: HttpUrl;
  protocolIntentsContract: Address; // for partner fee claims
};

export const solverConfig = {
  intentsContract: '0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef',
  solverApiEndpoint: 'https://api.sodax.com/v1/intent',
  protocolIntentsContract: '0xaFf2EDb3057ed6f9C1dA6c930b8ddDf2beE573A5',
} as const satisfies SolverConfig;

export type RelayConfig = {
  relayerApiEndpoint: HttpUrl;
  relayChainIdMap: Record<SpokeChainKey, IntentChainId>;
};

export const relayConfig = {
  relayerApiEndpoint: DEFAULT_RELAYER_API_ENDPOINT,
  relayChainIdMap: RelayChainIdMap,
} satisfies RelayConfig;
