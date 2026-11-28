import {
  BACKEND_API_BASE_PATH,
  DEFAULT_API_BASE_URL,
  DEFAULT_BACKEND_API_HEADERS,
  DEFAULT_BACKEND_API_TIMEOUT,
  DEFAULT_SPONSORING_API_ENDPOINT,
  type BackendApiConfig,
  type BaseApiConfig,
  type HttpUrl,
  type SponsoringApiConfig,
  type SwapsApiConfig,
} from '@sodax/types';
import { trimTrailingSlashes, type RequestOverrideConfig } from './api-utils.js';

/** Runtime shape of a merged `api` config: per-service slices alongside surviving flat fields; never narrowed. */
type LayeredApiConfig = Partial<BackendApiConfig> & {
  baseApiConfig?: Partial<BackendApiConfig>;
  swapsApiConfig?: Partial<SwapsApiConfig>;
  sponsoringApiConfig?: Partial<SponsoringApiConfig>;
};

/** A resolved backend data API config, whose `basePath` is always concrete. */
export type ResolvedBackendApiConfig = Required<BackendApiConfig>;

function flatLayer({ baseURL, timeout, headers }: LayeredApiConfig): Partial<BaseApiConfig> {
  return { baseURL, timeout, headers };
}

/** Scalars take the latest definition; headers merge by key. */
function layerConfigs(...slices: Array<Partial<BaseApiConfig> | undefined>): BaseApiConfig {
  return slices.reduce<BaseApiConfig>(
    (acc, slice) =>
      slice
        ? {
            // Truthy (not nullish) so a set-but-empty env var falls back, matching `makeRequest`.
            baseURL: slice.baseURL || acc.baseURL,
            timeout: slice.timeout ?? acc.timeout,
            headers: { ...acc.headers, ...slice.headers },
          }
        : acc,
    {
      baseURL: DEFAULT_API_BASE_URL,
      timeout: DEFAULT_BACKEND_API_TIMEOUT,
      headers: { ...DEFAULT_BACKEND_API_HEADERS },
    },
  );
}

function isHttpUrl(value: string): value is HttpUrl {
  return value.startsWith('http://') || value.startsWith('https://');
}

function normalizeBaseURL(baseURL: HttpUrl): HttpUrl {
  const trimmed = trimTrailingSlashes(baseURL);
  return isHttpUrl(trimmed) ? trimmed : baseURL;
}

/**
 * Strip the legacy `/be` suffix so old base URLs still resolve sibling services; retire with `DEFAULT_BACKEND_API_ENDPOINT`.
 * Returns `undefined` when the remainder isn't a valid absolute URL (e.g. `https://be`).
 */
function stripBackendMount(baseURL: string): HttpUrl | undefined {
  const trimmed = trimTrailingSlashes(baseURL);
  if (!trimmed.endsWith(BACKEND_API_BASE_PATH)) return undefined;
  const root = trimmed.slice(0, -BACKEND_API_BASE_PATH.length);
  return isHttpUrl(root) ? root : undefined;
}

export function stripLegacyBackendMount(baseURL: string): string {
  return stripBackendMount(baseURL) ?? baseURL;
}

/** Without the legacy trim, a per-call `…/v1/be` nests routes as `/be/be/…`. Sponsoring is deliberately excluded. */
export function normalizeOverrideBaseURL(override?: RequestOverrideConfig): RequestOverrideConfig | undefined {
  if (!override?.baseURL) return override;
  return { ...override, baseURL: stripLegacyBackendMount(override.baseURL) };
}

function toGatewayRoot(baseURL: HttpUrl): HttpUrl {
  return stripBackendMount(baseURL) ?? normalizeBaseURL(baseURL);
}

/** An explicit mount means a current-contract config: the legacy trim stands down and a trailing `/be` is real. */
function configuredBasePath(layers: LayeredApiConfig): string | undefined {
  return layers.baseApiConfig?.basePath ?? layers.basePath;
}

export function hasExplicitBasePath(layers: LayeredApiConfig): boolean {
  return configuredBasePath(layers) !== undefined;
}

/** Inspects only the flat / `baseApiConfig` URL: a `/be` `swapsApiConfig` is trimmed silently (it never worked). */
export function hasLegacyBackendBaseURL(layers: LayeredApiConfig): boolean {
  if (configuredBasePath(layers) !== undefined) return false;
  return stripBackendMount(layerConfigs(flatLayer(layers), layers.baseApiConfig).baseURL) !== undefined;
}

const PACKAGED_API_ORIGIN = new URL(DEFAULT_API_BASE_URL).origin;

function isOnPackagedOrigin(baseURL: string): boolean {
  return baseURL === PACKAGED_API_ORIGIN || baseURL.startsWith(`${PACKAGED_API_ORIGIN}/`);
}

/**
 * Checks the RESOLVED URL so slices are covered; only the packaged origin warns, since bare-origin
 * self-hosted/local services are legitimate.
 */
export function isMissingVersionPrefix(baseURL: string): boolean {
  const normalized = trimTrailingSlashes(baseURL);
  if (!isOnPackagedOrigin(normalized)) return false;
  return normalized !== DEFAULT_API_BASE_URL && !normalized.startsWith(`${DEFAULT_API_BASE_URL}/`);
}

function normalizeBasePath(basePath: string): string {
  const trimmed = trimTrailingSlashes(basePath.trim());
  const withoutLeadingSlashes = trimmed.replace(/^\/+/, '');
  return withoutLeadingSlashes.length === 0 ? '' : `/${withoutLeadingSlashes}`;
}

function resolveSharedApiConfig(layers: LayeredApiConfig, slice?: Partial<BaseApiConfig>): BaseApiConfig {
  const layered = layerConfigs(flatLayer(layers), layers.baseApiConfig, slice);
  const baseURL =
    configuredBasePath(layers) === undefined ? toGatewayRoot(layered.baseURL) : normalizeBaseURL(layered.baseURL);
  return { ...layered, baseURL };
}

export function resolveBaseApiConfig(layers: LayeredApiConfig): ResolvedBackendApiConfig {
  return {
    ...resolveSharedApiConfig(layers),
    basePath: normalizeBasePath(configuredBasePath(layers) ?? BACKEND_API_BASE_PATH),
  };
}

export function resolveSwapsApiConfig(layers: LayeredApiConfig): SwapsApiConfig {
  return resolveSharedApiConfig(layers, layers.swapsApiConfig);
}

/** Never inherits base URL or headers (separate origin; would leak credentials); timeout may inherit. */
export function resolveSponsoringApiConfig(layers: LayeredApiConfig): SponsoringApiConfig {
  const slice = layers.sponsoringApiConfig;
  return {
    baseURL: normalizeBaseURL(slice?.baseURL ?? DEFAULT_SPONSORING_API_ENDPOINT),
    timeout: slice?.timeout ?? resolveSharedApiConfig(layers).timeout,
    headers: { ...DEFAULT_BACKEND_API_HEADERS, ...slice?.headers },
    ...(slice?.apiKey === undefined ? {} : { apiKey: slice.apiKey }),
  };
}

/** No `basePath` (would nest under `/be`) and no slice: a `swapsApiConfig` slice moves only swaps. */
export function resolveBridgeApiConfig(layers: LayeredApiConfig): BaseApiConfig {
  return resolveSharedApiConfig(layers);
}

/** Gateway sibling like bridge: no `basePath`, no dedicated config slice. */
export function resolveLeverageYieldApiConfig(layers: LayeredApiConfig): BaseApiConfig {
  return resolveSharedApiConfig(layers);
}
