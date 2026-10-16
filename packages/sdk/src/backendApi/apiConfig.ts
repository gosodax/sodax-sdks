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

/**
 * Runtime shape of a resolved `api` config. `mergeSodaxConfig` deep-merges an override into the flat
 * default, so per-service slices arrive alongside surviving top-level flat fields. `ApiConfig` (both of
 * its variants) is assignable to this, so every resolver takes this shape and never narrows the union.
 */
type LayeredApiConfig = Partial<BackendApiConfig> & {
  baseApiConfig?: Partial<BackendApiConfig>;
  swapsApiConfig?: Partial<SwapsApiConfig>;
  sponsoringApiConfig?: Partial<SponsoringApiConfig>;
};

/** A resolved backend data API config, whose `basePath` is always concrete. */
export type ResolvedBackendApiConfig = Required<BackendApiConfig>;

/** The top-level flat fields, which layer underneath any per-service slice. */
function flatLayer({ baseURL, timeout, headers }: LayeredApiConfig): Partial<BaseApiConfig> {
  return { baseURL, timeout, headers };
}

/**
 * Layer slices left to right. Scalar values use the latest definition while
 * headers merge by key.
 */
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

/** Normalize an observable base URL while preserving its `HttpUrl` type. */
function normalizeBaseURL(baseURL: HttpUrl): HttpUrl {
  const trimmed = trimTrailingSlashes(baseURL);
  return isHttpUrl(trimmed) ? trimmed : baseURL;
}

/**
 * Strip the legacy backend mount from a base URL, or `undefined` when there is nothing to strip.
 *
 * Before the base URL became the shared gateway root it ended in `/be` — the backend data API's own
 * mount — in the packaged default and in every doc example. Removing that suffix keeps those values
 * working for the data API (which re-appends its `basePath`) and, unlike before, resolves the sibling
 * services (`/swaps/*`, `/bridge/*`) correctly instead of nesting them under `/be`. Retire this
 * alongside the deprecated `DEFAULT_BACKEND_API_ENDPOINT` on the next major.
 *
 * Returns `undefined` when the remainder would not be a valid absolute URL, so a host whose authority
 * merely ends in `be` (`https://be`) is left alone.
 */
function stripBackendMount(baseURL: string): HttpUrl | undefined {
  const trimmed = trimTrailingSlashes(baseURL);
  if (!trimmed.endsWith(BACKEND_API_BASE_PATH)) return undefined;
  const root = trimmed.slice(0, -BACKEND_API_BASE_PATH.length);
  return isHttpUrl(root) ? root : undefined;
}

/** Apply {@link stripBackendMount} to a per-call `baseURL` override, which is a plain string. */
export function stripLegacyBackendMount(baseURL: string): string {
  return stripBackendMount(baseURL) ?? baseURL;
}

/**
 * Normalize a per-call override's `baseURL`, leaving its other fields alone.
 *
 * A per-call override carries the same meaning as a configured `baseURL` — the gateway root — so it gets
 * the same legacy-mount trim. Without it, passing the old `…/v1/be` value per call nests every route
 * under the data API's mount: `/be/be/config/all` for the data API, `/be/swaps/*` and `/be/bridge/*` for
 * the siblings. Sponsoring is deliberately excluded, matching its config-level behaviour.
 */
export function normalizeOverrideBaseURL(override?: RequestOverrideConfig): RequestOverrideConfig | undefined {
  if (!override?.baseURL) return override;
  return { ...override, baseURL: stripLegacyBackendMount(override.baseURL) };
}

function toGatewayRoot(baseURL: HttpUrl): HttpUrl {
  return stripBackendMount(baseURL) ?? normalizeBaseURL(baseURL);
}

/**
 * The mount the consumer stated, if any. Its presence means a config written against the current
 * contract, so the legacy trim must stand down: the `baseURL` is a deliberate root, and a `/be` at the
 * end of it is a real path segment rather than the mount we would otherwise re-append.
 */
function configuredBasePath(layers: LayeredApiConfig): string | undefined {
  return layers.baseApiConfig?.basePath ?? layers.basePath;
}

/**
 * True when the consumer stated a mount explicitly, i.e. wrote this config against the current contract.
 * Callers use it to keep per-call handling consistent with the config-level decision.
 */
export function hasExplicitBasePath(layers: LayeredApiConfig): boolean {
  return configuredBasePath(layers) !== undefined;
}

/**
 * True when the configured base URL still carries the legacy backend mount, i.e. when the trim fired.
 * Only the flat / `baseApiConfig` value is inspected: a `/be`-suffixed `swapsApiConfig` is still
 * trimmed, but silently — that combination never worked, so repairing it needs no deprecation notice.
 */
export function hasLegacyBackendBaseURL(layers: LayeredApiConfig): boolean {
  if (configuredBasePath(layers) !== undefined) return false;
  // Read the base URL through `layerConfigs` so slice-over-flat precedence is stated in one place.
  return stripBackendMount(layerConfigs(flatLayer(layers), layers.baseApiConfig).baseURL) !== undefined;
}

/** Origin of the packaged gateway, so a base URL on that host can be checked for its version prefix. */
const PACKAGED_API_ORIGIN = new URL(DEFAULT_API_BASE_URL).origin;

function isOnPackagedOrigin(baseURL: string): boolean {
  return baseURL === PACKAGED_API_ORIGIN || baseURL.startsWith(`${PACKAGED_API_ORIGIN}/`);
}

/**
 * True when a RESOLVED base URL points at the packaged gateway host but omits its version prefix.
 *
 * `baseURL` is the origin plus the deployment's version prefix, so `https://api.sodax.com` on its own
 * resolves a service one segment short — `/be/config/all`, `/swaps/tokens` — and 404s. Only the data API
 * has a `basePath` to compensate, so the others cannot be rescued after the fact; the fix is always to
 * put the prefix back in `baseURL`.
 *
 * Takes the resolved value rather than the config so it holds for every service however its base URL was
 * layered — a `swapsApiConfig` or `sponsoringApiConfig` slice reaches its service without passing through
 * `baseApiConfig`, so a config-shaped check would miss exactly those.
 *
 * Deliberately scoped to the packaged origin: a self-hosted gateway or a local service mounted at a bare
 * origin (`http://localhost:3011`, `http://localhost:3008`) is legitimate and must not warn.
 */
export function isMissingVersionPrefix(baseURL: string): boolean {
  const normalized = trimTrailingSlashes(baseURL);
  if (!isOnPackagedOrigin(normalized)) return false;
  return normalized !== DEFAULT_API_BASE_URL && !normalized.startsWith(`${DEFAULT_API_BASE_URL}/`);
}

/** Normalize a service mount path: no surrounding whitespace, exactly one leading slash, no trailing slash. */
function normalizeBasePath(basePath: string): string {
  const trimmed = trimTrailingSlashes(basePath.trim());
  const withoutLeadingSlashes = trimmed.replace(/^\/+/, '');
  return withoutLeadingSlashes.length === 0 ? '' : `/${withoutLeadingSlashes}`;
}

/** Layer flat fields, the `baseApiConfig` slice, then an optional per-service slice onto the shared root. */
function resolveSharedApiConfig(layers: LayeredApiConfig, slice?: Partial<BaseApiConfig>): BaseApiConfig {
  const layered = layerConfigs(flatLayer(layers), layers.baseApiConfig, slice);
  const baseURL =
    configuredBasePath(layers) === undefined ? toGatewayRoot(layered.baseURL) : normalizeBaseURL(layered.baseURL);
  return { ...layered, baseURL };
}

/** Resolve base API config with global defaults, including the backend data API's own mount path. */
export function resolveBaseApiConfig(layers: LayeredApiConfig): ResolvedBackendApiConfig {
  return {
    ...resolveSharedApiConfig(layers),
    basePath: normalizeBasePath(configuredBasePath(layers) ?? BACKEND_API_BASE_PATH),
  };
}

/** Resolve swaps config over base config and global defaults. */
export function resolveSwapsApiConfig(layers: LayeredApiConfig): SwapsApiConfig {
  return resolveSharedApiConfig(layers, layers.swapsApiConfig);
}

/**
 * Resolve the effective config for the sponsoring API.
 *
 * Base URL and headers never inherit from the base API because sponsoring uses
 * a separate origin; inheriting could leak credentials. Timeout may inherit.
 * Normalize the URL because callers observe it and config caching keys on it. Its default is the same
 * gateway root the other services resolve, reached without inheriting.
 */
export function resolveSponsoringApiConfig(layers: LayeredApiConfig): SponsoringApiConfig {
  const slice = layers.sponsoringApiConfig;
  return {
    baseURL: normalizeBaseURL(slice?.baseURL ?? DEFAULT_SPONSORING_API_ENDPOINT),
    timeout: slice?.timeout ?? resolveSharedApiConfig(layers).timeout,
    headers: { ...DEFAULT_BACKEND_API_HEADERS, ...slice?.headers },
    ...(slice?.apiKey === undefined ? {} : { apiKey: slice.apiKey }),
  };
}

/**
 * Resolve the effective config for the bridge API. Its `/bridge/*` routes hang off the shared gateway
 * root, so it reads the same config as the base API but must NOT carry the data API's `basePath` —
 * that would nest the bridge routes under `/be`. There is deliberately no `bridgeApiConfig` slice:
 * relocate the bridge by setting the top-level `baseURL`, the `baseApiConfig` slice, or a per-call
 * `RequestOverrideConfig`. A `swapsApiConfig` slice moves only `sodax.api.swaps`.
 */
export function resolveBridgeApiConfig(layers: LayeredApiConfig): BaseApiConfig {
  return resolveSharedApiConfig(layers);
}

/**
 * Resolve the effective config for the leverage-yield API. Its `/leverage-yield/*` routes are gateway
 * siblings of `/swaps` and `/bridge`, so — like {@link resolveBridgeApiConfig} — it reads the same
 * config as the base API but must NOT carry the data API's `basePath`. There is deliberately no
 * `leverageYieldApiConfig` slice: relocate it via the top-level `baseURL`, the `baseApiConfig` slice,
 * or a per-call `RequestOverrideConfig`.
 */
export function resolveLeverageYieldApiConfig(layers: LayeredApiConfig): BaseApiConfig {
  return resolveSharedApiConfig(layers);
}
