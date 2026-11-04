import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONFIG_VERSION,
  type ParsedConfigVersion,
  SDK_VERSION,
  configVersionFor,
  formatConfigVersion,
  parseConfigVersion,
} from './index.js';

/**
 * Covers the shipped half of the CONFIG_VERSION encoding. `scripts/config-version.mjs` holds the
 * release-time mirror of the same formula — it cannot be imported here, because the release tooling
 * runs before any build and lives outside this package's `rootDir`. The integers below are therefore
 * restated from `scripts/config-version.test.mjs` on purpose: both implementations are pinned to one
 * set of literals, so a divergence fails on one side or the other.
 */

const MIN = 1_000_000;
const MAX = 99_999_999;

// A1 in scripts/config-version.test.mjs.
const NORMAL: readonly (readonly [string, number])[] = [
  ['1.0.0-rc.1', 1_000_001],
  ['1.0.0', 1_000_099],
  ['2.0.0-rc.17', 2_000_017],
  ['2.2.0-rc.5', 2_020_005],
  ['2.2.0-rc.6', 2_020_006],
  ['2.2.0', 2_020_099],
  ['2.2.1', 2_020_199],
  ['2.3.0-rc.1', 2_030_001],
  ['2.3.0', 2_030_099],
  ['2.9.0', 2_090_099],
  ['2.10.0', 2_100_099],
  ['2.10.1-rc.2', 2_100_102],
  ['3.0.0-rc.1', 3_000_001],
  ['3.0.0', 3_000_099],
  ['10.20.30', 10_203_099],
  ['99.99.99', 99_999_999],
];

// A2 in scripts/config-version.test.mjs.
const BORDER: readonly (readonly [string, number])[] = [
  ['1.0.0-rc.0', 1_000_000],
  ['1.0.0', 1_000_099],
  ['1.99.99-rc.98', 1_999_998],
  ['2.0.0-rc.0', 2_000_000],
  ['2.0.99', 2_009_999],
  ['2.99.0', 2_990_099],
  ['2.99.99', 2_999_999],
  ['99.0.0-rc.0', 99_000_000],
  ['99.99.99-rc.98', 99_999_998],
  ['99.99.99', 99_999_999],
];

const ALL = [...NORMAL, ...BORDER];

// A3 in scripts/config-version.test.mjs, where these throw. Here they must return null instead.
const REJECTED_VERSIONS: readonly unknown[] = [
  '0.0.1',
  '0.1.0',
  '100.0.0',
  '2.100.0',
  '2.2.100',
  '2.2.0-rc.99',
  '2.2.0-rc.100',
  '2.3.0-beta.1',
  '02.1.0',
  '2.01.0',
  '2.1.0-rc.007',
  '2.1',
  'v2.1.0',
  '',
  '2.1.0 ',
  null,
  undefined,
  2.1,
];

const NOT_CONFIG_VERSIONS: readonly unknown[] = [
  235, // the legacy counter an API on an older SDK still serves
  100, // the same, from main
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  999_999, // just below the floor
  100_000_000, // just above the ceiling
  2 ** 31,
  Number.MAX_SAFE_INTEGER + 1, // decoded to a fabricated {major: 9007199254, …} before the upper bound
  '2020006', // a string, not a number
  null,
  undefined,
];

// The signatures take string/number; feeding them anything else is the point of these cases, and a
// consumer with `any` in scope can do exactly this.
const encodeUnknown = (value: unknown): number | null => configVersionFor(value as string);
const decodeUnknown = (value: unknown): string | null => formatConfigVersion(value as number);
const parseUnknown = (value: unknown): unknown => parseConfigVersion(value as number);

describe('configVersionFor', () => {
  it.each(ALL)('encodes %s as %i', (version, expected) => {
    expect(configVersionFor(version)).toBe(expected);
  });

  it.each(REJECTED_VERSIONS)('returns null for %o without throwing', value => {
    expect(encodeUnknown(value)).toBeNull();
  });
});

// rc is asserted against null explicitly, never for truthiness: rc.0 is legal and 0 is falsy.
const FIELDS: readonly (readonly [number, ParsedConfigVersion])[] = [
  [1_000_000, { major: 1, minor: 0, patch: 0, rc: 0 }],
  [2_020_006, { major: 2, minor: 2, patch: 0, rc: 6 }],
  [2_020_099, { major: 2, minor: 2, patch: 0, rc: null }],
  [2_020_199, { major: 2, minor: 2, patch: 1, rc: null }],
  [2_100_102, { major: 2, minor: 10, patch: 1, rc: 2 }],
  [10_203_099, { major: 10, minor: 20, patch: 30, rc: null }],
  [99_999_998, { major: 99, minor: 99, patch: 99, rc: 98 }],
];

describe('parseConfigVersion', () => {
  it.each(FIELDS)('unpacks %i into its fields', (encoded, expected) => {
    expect(parseConfigVersion(encoded)).toEqual(expected);
  });

  it.each(ALL)('decodes the number for %s', (version, encoded) => {
    expect(parseConfigVersion(encoded)).not.toBeNull();
    expect(formatConfigVersion(encoded)).toBe(version);
  });

  it.each(NOT_CONFIG_VERSIONS)('returns null for %o without throwing', value => {
    expect(parseUnknown(value)).toBeNull();
    expect(decodeUnknown(value)).toBeNull();
  });
});

describe('round trip', () => {
  it.each(ALL)('%s survives encode then decode', (version, encoded) => {
    expect(formatConfigVersion(configVersionFor(version) as number)).toBe(version);
    expect(configVersionFor(formatConfigVersion(encoded) as string)).toBe(encoded);
  });
});

describe('the committed constant', () => {
  it('is inside the encoding', () => {
    expect(CONFIG_VERSION).toBeGreaterThanOrEqual(MIN);
    expect(CONFIG_VERSION).toBeLessThanOrEqual(MAX);
    expect(parseConfigVersion(CONFIG_VERSION)).not.toBeNull();
  });

  it('matches this package version, proving the constant, the decoder and the manifest agree', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(SDK_VERSION).toBe(manifest.version);
    expect(configVersionFor(manifest.version)).toBe(CONFIG_VERSION);
  });
});
