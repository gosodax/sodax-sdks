export * from './shared/index.js';
export * from './common/index.js';
export * from './chains/index.js';
export * from './sodax-config/index.js';
export * from './backend/index.js';
export * from './bitcoin/index.js';
export * from './dex/index.js';
export * from './evm/index.js';
export * from './hooks/index.js';
export * from './icon/index.js';
export * from './injective/index.js';
export * from './moneyMarket/index.js';
export * from './leverageYield/index.js';
export * from './near/index.js';
export * from './solana/index.js';
export * from './stacks/index.js';
export * from './stellar/index.js';
export * from './sui/index.js';
export * from './swap/index.js';
export * from './tron/index.js';
export * from './utils/index.js';
export * from './wallet/index.js';

/**
 * Identifies the SDK release a SODAX config belongs to. Derived from this package's version by
 * `scripts/bump-versions.sh` — never hand-edit it. The backend serves this same constant from the SDK
 * release it has installed, so comparing it against `GetAllConfigResponseV2.version` answers "do the
 * SDK and the API run the same release?".
 *
 * Encoding: `major * 1e6 + minor * 1e4 + patch * 100 + (rc ?? 99)`, where the 99 rc slot is the
 * sentinel for a stable release. Use {@link configVersionFor} and {@link formatConfigVersion} rather
 * than unpacking it by hand.
 */
export const CONFIG_VERSION = 2_000_017; // 2.0.0-rc.17

/** Highest rc slot, reserved for a stable release so it outranks every rc of the same triple. */
const RC_STABLE = 99;
const MIN_CONFIG_VERSION = 1_000_000;
const MAX_CONFIG_VERSION = 99_999_999;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/;

/** A version decoded from a config version number. `rc` is `null` for a stable release. */
export type ParsedConfigVersion = {
  major: number;
  minor: number;
  patch: number;
  rc: number | null;
};

/**
 * Encodes an `X.Y.Z` / `X.Y.Z-rc.N` version as its config version number, or `null` when the version
 * is outside the grammar (`2.3.0-beta.1`) or the domain (major outside 1..99, minor or patch above
 * 99, rc above 98). Total by design: the release tooling throws on these, application code should not.
 */
export function configVersionFor(version: string): number | null {
  const match = typeof version === 'string' ? version.match(VERSION_PATTERN) : null;
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const rc = match[4] === undefined ? null : Number(match[4]);
  if (major < 1 || major > 99 || minor > 99 || patch > 99) return null;
  if (rc !== null && rc > 98) return null;
  return major * 1_000_000 + minor * 10_000 + patch * 100 + (rc === null ? RC_STABLE : rc);
}

// Total on purpose: the domain check lives in parseConfigVersion, so SDK_VERSION can project the
// committed constant without routing through a nullable step it would then have to narrow.
const unpack = (value: number): ParsedConfigVersion => {
  const slot = value % 100;
  return {
    major: Math.floor(value / 1_000_000),
    minor: Math.floor(value / 10_000) % 100,
    patch: Math.floor(value / 100) % 100,
    rc: slot === RC_STABLE ? null : slot,
  };
};

const render = ({ major, minor, patch, rc }: ParsedConfigVersion): string =>
  `${major}.${minor}.${patch}${rc === null ? '' : `-rc.${rc}`}`;

/**
 * Decodes a config version number, or `null` when it is not one — which includes the small counter
 * values an API running an older SDK still serves, and any non-integer or out-of-range input.
 */
export function parseConfigVersion(value: number): ParsedConfigVersion | null {
  if (!Number.isInteger(value) || value < MIN_CONFIG_VERSION || value > MAX_CONFIG_VERSION) return null;
  return unpack(value);
}

/** Renders a config version number as its version string, or `null` when it is not one. */
export function formatConfigVersion(value: number): string | null {
  const parsed = parseConfigVersion(value);
  return parsed === null ? null : render(parsed);
}

/**
 * This package's version, projected from {@link CONFIG_VERSION} rather than written separately, so the
 * two cannot disagree. Always a version string: `scripts/bump-versions.sh` derives the constant, and
 * `config-version.test.ts` asserts it against the manifest.
 */
export const SDK_VERSION: string = render(unpack(CONFIG_VERSION));
