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
export * from './xrp/index.js';
export * from './cardano/index.js';
export * from './ton/index.js';
export * from './zcash/index.js';
export * from './utils/index.js';
export * from './wallet/index.js';

/** SDK release of a config; derived by `scripts/bump-versions.sh`, never hand-edit. Compare with `GetAllConfigResponseV2.version`
 * to detect SDK/API release drift. Encoding: `major*1e6 + minor*1e4 + patch*100 + (rc ?? 99)`; 99 marks a stable release. */
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

/** Encodes `X.Y.Z[-rc.N]`; `null` outside the grammar or domain (major 1..99, minor/patch <= 99, rc <= 98).
 * Total by design: the release tooling throws on these, application code should not. */
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

/** `null` when not a config version, incl. the small counters an API on an older SDK still serves. */
export function parseConfigVersion(value: number): ParsedConfigVersion | null {
  if (!Number.isInteger(value) || value < MIN_CONFIG_VERSION || value > MAX_CONFIG_VERSION) return null;
  return unpack(value);
}

/** Renders a config version number as its version string, or `null` when it is not one. */
export function formatConfigVersion(value: number): string | null {
  const parsed = parseConfigVersion(value);
  return parsed === null ? null : render(parsed);
}

/** Projected from {@link CONFIG_VERSION} rather than written separately, so the two cannot disagree. */
export const SDK_VERSION: string = render(unpack(CONFIG_VERSION));
