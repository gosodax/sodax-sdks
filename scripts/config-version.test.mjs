import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CONFIG_PATH,
  MANIFEST_PATH,
  MAX_CONFIG_VERSION,
  MIN_CONFIG_VERSION,
  compareVersions,
  configVersionDriftErrors,
  configVersionErrors,
  configVersionFor,
  configVersionForOrThrow,
  decodeConfigVersion,
  readConfigVersion,
  readManifestVersion,
} from './config-version.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');

// A1 — normal cases. Shared with packages/types/src/config-version.test.ts, which asserts the same
// integers against the runtime encoder: the two implementations are pinned to one set of literals.
export const NORMAL = [
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
  ['2.10.0', 2_100_099], // 2.9.0 < 2.10.0: the string-compare trap
  ['2.10.1-rc.2', 2_100_102],
  ['3.0.0-rc.1', 3_000_001],
  ['3.0.0', 3_000_099],
  ['10.20.30', 10_203_099],
  ['99.99.99', 99_999_999],
];

// A2 — every field at its minimum and maximum.
export const BORDER = [
  ['1.0.0-rc.0', 1_000_000, 'global minimum; rc.0 is legal'],
  ['1.0.0', 1_000_099, 'stable sentinel at the floor'],
  ['1.99.99-rc.98', 1_999_998, 'every field maxed below major 2'],
  ['2.0.0-rc.0', 2_000_000, 'major boundary'],
  ['2.0.99', 2_009_999, 'patch max, no carry into minor'],
  ['2.99.0', 2_990_099, 'minor max'],
  ['2.99.99', 2_999_999, 'minor and patch maxed, no carry into major'],
  ['99.0.0-rc.0', 99_000_000, 'major max'],
  ['99.99.99-rc.98', 99_999_998, 'largest rc value'],
  ['99.99.99', 99_999_999, 'global maximum'],
];

// A3 — the message is the operator's only guidance mid-release, so it is part of the contract.
export const REJECTED = [
  ['0.0.1', 'major 0 outside 1..99'],
  ['0.1.0', 'major 0 outside 1..99'],
  ['100.0.0', 'major 100 outside 1..99'],
  ['2.100.0', 'minor 100 outside 0..99'],
  ['2.2.100', 'patch 100 outside 0..99 (bump the minor instead)'],
  ['2.2.0-rc.99', 'rc 99 outside 0..98 (99 is reserved for stable)'],
  ['2.2.0-rc.100', 'rc 100 outside 0..98 (99 is reserved for stable)'],
  ['2.3.0-beta.1', 'not a valid version'], // the publish glob accepts it; the tooling must not
  ['02.1.0', 'not a valid version'], // leading zeros: bump-versions.sh used to accept these
  ['2.01.0', 'not a valid version'],
  ['2.1.0-rc.007', 'not a valid version'],
  ['2.1', 'not a valid version'],
  ['v2.1.0', 'not a valid version'],
  ['', 'not a valid version'],
  ['2.1.0 ', 'not a valid version'],
  [null, 'not a valid version'],
  [undefined, 'not a valid version'],
  [2.1, 'not a valid version'],
];

// A4 — successor pairs straddling each carry. The gap is asserted, not just the order: a dense
// (gap 1) row is where an off-by-one in a field would show up.
const ADJACENT = [
  ['1.0.0-rc.0', '1.0.0-rc.1', 1, 'first rc to second'],
  ['1.0.0-rc.98', '1.0.0', 1, 'last rc to its stable (rc slot to sentinel)'],
  ['2.2.0-rc.98', '2.2.0', 1, 'the same, at the live version'],
  ['2.2.0', '2.2.1-rc.0', 1, "stable to the next patch's first rc"],
  ['2.2.99', '2.3.0-rc.0', 1, 'patch max to next minor — the patch/minor carry'],
  ['2.2.99', '2.3.0', 100, 'same carry, to the stable'],
  ['2.99.99', '3.0.0-rc.0', 1, 'minor max to next major — the minor/major carry'],
  ['2.99.99', '3.0.0', 100, 'same carry, to the stable'],
  ['2.9.0', '2.10.0', 10_000, 'single to double digit minor — the string-compare trap'],
  ['2.0.9', '2.0.10', 100, 'single to double digit patch'],
  ['98.99.99', '99.0.0-rc.0', 1, 'last major boundary inside the domain'],
];

// Fixture helpers. DECOY_* exercise A7: the seds used to match any identifier ending in
// CONFIG_VERSION, so adding exports to index.ts would have corrupted a release silently.
const DECOY_ABOVE = 'export const MIN_CONFIG_VERSION = 200;';
const DECOY_BELOW = 'export const MAX_CONFIG_VERSION = 300;';
// Read from bump-versions.sh rather than restated: a fixture missing a package the script bumps fails
// as an unreadable path, blaming whichever PR added the package instead of the drift.
const PACKAGE_DIRS = (() => {
  const script = readFileSync(join(REPO_ROOT, 'scripts/bump-versions.sh'), 'utf8');
  const declared = /^PACKAGES=\(([^)]*)\)/m.exec(script);
  assert.ok(declared, 'bump-versions.sh must declare a PACKAGES=(...) array');
  const dirs = declared[1].trim().split(/\s+/).filter(Boolean);
  assert.ok(dirs.length > 0, 'bump-versions.sh declared an empty PACKAGES array');
  return dirs;
})();

const workspace = (t, version, configVersion, { decoys = false } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'config-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages/types/src'), { recursive: true });
  for (const directory of PACKAGE_DIRS) {
    mkdirSync(join(root, 'packages', directory), { recursive: true });
    writeFileSync(
      join(root, 'packages', directory, 'package.json'),
      `${JSON.stringify({ name: `@sodax/${directory}`, version }, null, 2)}\n`,
    );
  }
  const body = `export const CONFIG_VERSION = ${configVersion}; // ${version}\n`;
  writeFileSync(join(root, CONFIG_PATH), decoys ? `${DECOY_ABOVE}\n${body}${DECOY_BELOW}\n` : body);
  return root;
};

// Runs the real bump-versions.sh, so these are end-to-end rather than a restatement of the formula.
const runBump = (root, version) => {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  for (const file of ['bump-versions.sh', 'config-version.mjs']) {
    writeFileSync(join(root, 'scripts', file), readFileSync(join(REPO_ROOT, 'scripts', file)));
  }
  execFileSync('bash', ['scripts/bump-versions.sh', version], { cwd: root, encoding: 'utf8' });
  return readFileSync(join(root, CONFIG_PATH), 'utf8');
};

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('A1: encodes the documented versions', () => {
  for (const [version, expected] of NORMAL) {
    assert.equal(configVersionFor(version), expected, version);
    assert.equal(configVersionForOrThrow(version), expected, version);
  }
});

test('A2: encodes every field boundary', () => {
  for (const [version, expected, why] of BORDER) {
    assert.equal(configVersionFor(version), expected, `${version} — ${why}`);
  }
});

test('A3: configVersionForOrThrow rejects out-of-grammar and out-of-domain versions', () => {
  for (const [version, message] of REJECTED) {
    assert.throws(() => configVersionForOrThrow(version), new RegExp(escapeRegExp(message)), String(version));
  }
});

test('A3: configVersionFor returns null for the same inputs, never throwing', () => {
  for (const [version] of REJECTED) {
    assert.equal(configVersionFor(version), null, String(version));
  }
});

// release.mjs reads these in its version guard, so the messages are the operator's re-prompt.
test('A3: configVersionErrors reports the same reasons without throwing', () => {
  for (const [version, message] of REJECTED) {
    const errors = configVersionErrors(version);
    assert.equal(errors.length, 1, String(version));
    assert.match(errors[0], new RegExp(escapeRegExp(message)), String(version));
  }
  for (const [version] of [...NORMAL, ...BORDER]) {
    assert.deepEqual(configVersionErrors(version), [], version);
  }
});

test('A4: each field carry increases by exactly the documented gap', () => {
  for (const [from, to, gap, boundary] of ADJACENT) {
    const [low, high] = [configVersionFor(from), configVersionFor(to)];
    assert.ok(low < high, `${from} (${low}) must sort below ${to} (${high}) — ${boundary}`);
    assert.equal(high - low, gap, `${from} -> ${to} — ${boundary}`);
  }
});

test('A4: the domain has the documented absolutes', () => {
  assert.equal(configVersionFor('1.0.0-rc.0'), MIN_CONFIG_VERSION);
  assert.equal(configVersionFor('99.99.99'), MAX_CONFIG_VERSION);
});

// A4b — seeded so CI cannot flake. A mulberry32 PRNG keeps the sample identical on every run.
const seeded = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

const sampleVersions = (count, seed = 20_260_911) => {
  const random = seeded(seed);
  const pick = bound => Math.floor(random() * bound);
  const versions = new Set();
  while (versions.size < count) {
    const rc = pick(100) === 0 ? null : pick(99); // 0..98, with stable sampled too
    versions.add(`${1 + pick(99)}.${pick(100)}.${pick(100)}${rc === null ? '' : `-rc.${rc}`}`);
  }
  return [...versions];
};

test('A4b: the encoding is injective over a sampled domain (I0)', () => {
  const versions = sampleVersions(3000);
  const encoded = versions.map(configVersionFor);
  assert.ok(
    encoded.every(value => value !== null),
    'every sampled version must be inside the domain',
  );
  assert.equal(new Set(encoded).size, versions.length, 'two versions must never share a number');
});

test('A4b: encode and decode round-trip in both directions', () => {
  for (const version of sampleVersions(3000)) {
    const encoded = configVersionFor(version);
    assert.equal(decodeConfigVersion(encoded), version);
    assert.equal(configVersionFor(decodeConfigVersion(encoded)), encoded);
  }
});

test('A4b: ordering agrees with compareVersions (I1)', () => {
  const versions = sampleVersions(600);
  for (let index = 1; index < versions.length; index++) {
    const [left, right] = [versions[index - 1], versions[index]];
    assert.equal(
      Math.sign(configVersionFor(left) - configVersionFor(right)),
      Math.sign(compareVersions(left, right)),
      `${left} vs ${right}`,
    );
  }
});

test('A5: the encoder is idempotent', () => {
  // The counter it replaces was not: a second bump-versions.sh run silently produced +2.
  assert.equal(configVersionFor('2.2.0-rc.6'), configVersionFor('2.2.0-rc.6'));
  assert.equal(configVersionForOrThrow('2.2.0'), configVersionForOrThrow('2.2.0'));
});

test('A6: the committed CONFIG_VERSION matches this repo manifest', () => {
  const version = readManifestVersion(REPO_ROOT);
  assert.equal(
    readConfigVersion(REPO_ROOT),
    configVersionForOrThrow(version),
    `${CONFIG_PATH} must encode ${MANIFEST_PATH}'s ${version}`,
  );
  assert.deepEqual(configVersionDriftErrors(REPO_ROOT), []);
});

test('A6: drift is reported when the constant and the manifest disagree', t => {
  const root = workspace(t, '2.2.0-rc.6', 2_020_099);
  const errors = configVersionDriftErrors(root);
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /2020099/);
  assert.match(errors.join('\n'), /2020006/);
});

test('A7: the bump seds are anchored and leave CONFIG_VERSION-suffixed decoys alone', {
  skip: process.platform === 'win32',
}, t => {
  const root = workspace(t, '2.2.0-rc.5', 2_020_005, { decoys: true });
  const updated = runBump(root, '2.2.0-rc.6');
  assert.match(updated, /^export const CONFIG_VERSION = 2020006; \/\/ 2\.2\.0-rc\.6$/m);
  assert.ok(updated.includes(DECOY_ABOVE), 'a decoy above the constant must be untouched');
  assert.ok(updated.includes(DECOY_BELOW), 'a decoy below the constant must be untouched');
});

test('A7: the bump derives rather than incrementing', { skip: process.platform === 'win32' }, t => {
  const root = workspace(t, '2.2.0-rc.5', 2_020_005);
  assert.equal(readConfigVersion(root), 2_020_005);
  runBump(root, '2.2.0');
  assert.equal(readConfigVersion(root), 2_020_099, 'a stable release takes the 99 sentinel, not +1');
  assert.equal(readManifestVersion(root), '2.2.0');
});

test('A8: the CLI prints the number for a valid version', { skip: process.platform === 'win32' }, () => {
  const stdout = execFileSync('node', [join(REPO_ROOT, 'scripts/config-version.mjs'), '2.2.0-rc.6'], {
    encoding: 'utf8',
  });
  assert.equal(stdout.trim(), '2020006');
});

test('A8: the CLI prints the bare number even when FORCE_COLOR is set', { skip: process.platform === 'win32' }, () => {
  const stdout = execFileSync('node', [join(REPO_ROOT, 'scripts/config-version.mjs'), '2.2.0-rc.6'], {
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  assert.equal(stdout, '2020006\n');
});

test('A8: the CLI exits non-zero on an invalid version', { skip: process.platform === 'win32' }, () => {
  assert.throws(() =>
    execFileSync('node', [join(REPO_ROOT, 'scripts/config-version.mjs'), '2.2.100'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  );
});

test('A8: --check passes on this repo', { skip: process.platform === 'win32' }, () => {
  const stdout = execFileSync('node', [join(REPO_ROOT, 'scripts/config-version.mjs'), '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.match(stdout, /matches/);
});
