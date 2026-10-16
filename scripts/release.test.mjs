import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  ReleaseError,
  commitBullet,
  commitGroup,
  compareVersions,
  cutRelease,
  discoverPublishablePackages,
  packageListErrors,
  packageListsIn,
  parseLog,
  parsePackageTag,
  parseSdksTag,
  parseReleaseArgs,
  parseRemoteRepo,
  parseVersion,
  porcelainEntries,
  previewSubject,
  renderNotes,
  sanitizeSubject,
  versionAdvanceErrors,
} from './release.mjs';
import { configVersionFor, configVersionForOrThrow } from './config-version.mjs';

const REPO_ROOT = join(import.meta.dirname, '..');
const MAIN = 'a'.repeat(40);
const RELEASE = 'e'.repeat(40);
const ROOT_COMMIT = 'r'.repeat(40);
const ALL_DIRS = [
  'types',
  'libs',
  'swaps-api',
  'bridge-api',
  'skills',
  'wallet-sdk-core',
  'sdk',
  'wallet-sdk-react',
  'dapp-kit',
];
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

// bump-versions.sh derives CONFIG_VERSION through config-version.mjs, so both must land in the fixture.
const copyReleaseScripts = root => {
  writeFileSync(join(root, 'scripts/bump-versions.sh'), readFileSync(join(import.meta.dirname, 'bump-versions.sh')), {
    mode: 0o755,
  });
  writeFileSync(
    join(root, 'scripts/config-version.mjs'),
    readFileSync(join(import.meta.dirname, 'config-version.mjs')),
  );
};

const createWorkspace = (t, directories = ALL_DIRS, version = '2.1.0') => {
  const root = mkdtempSync(join(tmpdir(), 'release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'packages/types/src'), { recursive: true });
  writeFileSync(
    join(root, 'packages/types/src/index.ts'),
    // ?? 0: some fixtures sit at 0.0.0 to exercise the no-tags guards, and a 0.x version is
    // deliberately outside the encoding. Those tests never reach the CONFIG_VERSION assertion.
    `export const CONFIG_VERSION = ${configVersionFor(version) ?? 0}; // ${version}\n`,
  );
  writeFileSync(join(root, 'scripts/bump-versions.sh'), `PACKAGES=(${directories.join(' ')})\n`);
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(
    join(root, '.github/workflows/sdks-publish.yml'),
    `PACKAGES=(${[...directories].reverse().join(' ')})\nPACKAGES=(${directories.join(' ')})\n`,
  );
  for (const directory of directories) {
    mkdirSync(join(root, 'packages', directory), { recursive: true });
    writeJson(join(root, 'packages', directory, 'package.json'), {
      name: `@sodax/${directory}`,
      version,
      private: false,
    });
  }
  return root;
};

const porcelainFor = directories =>
  [...directories.map(d => ` M packages/${d}/package.json`), ' M packages/types/src/index.ts'].join('\n');

const commitRecord = (sha, subject, author = 'dev', body = '') => `${sha}\x1f${subject}\x1f${author}\x1f${body}\x1e`;

// Stands in for bump-versions.sh so tests that only exercise the surrounding flow still pass verification.
const fakeBump =
  (root, directories = ALL_DIRS) =>
  (_command, args) => {
    const version = args[1];
    for (const directory of directories) {
      const path = join(root, 'packages', directory, 'package.json');
      writeJson(path, { ...JSON.parse(readFileSync(path, 'utf8')), version });
    }
    writeFileSync(
      join(root, 'packages/types/src/index.ts'),
      `export const CONFIG_VERSION = ${configVersionFor(version) ?? 0}; // ${version}\n`,
    );
    return '';
  };

const gitStub = ({
  branch = 'release',
  status = ['', porcelainFor(ALL_DIRS)],
  tags = ['@sdks@2.0.0', '@sdks@2.1.0', '@sdks@2.2.0-rc.1'],
  packageTags = [],
  remoteMain = MAIN,
  remoteRelease = RELEASE,
  localRelease = RELEASE,
  headContains = { 'origin/release': 0, '@sdks@2.2.0-rc.1': 0 },
  log = '',
  releaseOnlyLog = '',
  calls = [],
} = {}) => {
  const statuses = [...status];
  return args => {
    const key = args.join(' ');
    calls.push(key);
    if (key === 'branch --show-current') return `${branch}\n`;
    if (key === 'status --porcelain') return statuses.length > 1 ? statuses.shift() : statuses[0];
    if (key === 'rev-parse origin/main') return `${MAIN}\n`;
    if (key === 'ls-remote origin refs/heads/main') return `${remoteMain}\trefs/heads/main\n`;
    if (key === 'ls-remote origin refs/heads/release') {
      return remoteRelease ? `${remoteRelease}\trefs/heads/release\n` : '';
    }
    if (key === 'rev-parse origin/release') return `${localRelease}\n`;
    if (key.startsWith('rev-list --count HEAD..'))
      return `${headContains[key.slice('rev-list --count HEAD..'.length)] ?? 0}\n`;
    if (key === 'ls-remote --tags origin @sdks@*') {
      return tags.map(tag => `${'c'.repeat(40)}\trefs/tags/${tag}`).join('\n');
    }
    if (key === 'ls-remote --tags origin @sodax/*@*') {
      return packageTags.map(tag => `${'c'.repeat(40)}\trefs/tags/${tag}`).join('\n');
    }
    if (key === 'merge-base origin/main HEAD') return `${MAIN}\n`;
    if (key.startsWith('merge-base origin/main @sdks@')) return `${'b'.repeat(40)}\n`;
    if (key === `rev-list --count ${MAIN}..origin/main`) return '0\n';
    if (key === 'rev-list --max-parents=0 origin/main') return `${ROOT_COMMIT}\n`;
    if (key === 'remote get-url origin') return 'git@github.com:icon-project/sodax-sdks.git\n';
    if (key.startsWith('log --first-parent')) return log;
    if (key.startsWith('log --no-merges')) return releaseOnlyLog;
    throw new Error(`unexpected git call: ${key}`);
  };
};

const run = (root, options = {}) =>
  cutRelease({
    workspaceRoot: root,
    execGit: options.execGit ?? gitStub(options.stub ?? {}),
    runCommand: options.runCommand ?? fakeBump(root, options.directories ?? ALL_DIRS),
    prompt: options.prompt ?? (async () => '2.2.0'),
    log: options.log ?? (() => {}),
    ...(options.version === undefined ? {} : { version: options.version }),
  });

test('version parsing and ordering match the published tag semantics', () => {
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('v1.2.3'), null);
  assert.equal(parseVersion('1.2.3-beta.1'), null);
  assert.equal(parseVersion('02.2.0'), null);
  assert.ok(parseVersion('2.2.0-rc.1'));
  assert.ok(compareVersions('2.2.0', '2.2.0-rc.1') > 0, 'stable outranks its own rc');
  assert.ok(compareVersions('2.2.0-rc.2', '2.2.0-rc.1') > 0);
  assert.ok(compareVersions('2.1.0', '2.2.0-rc.1') < 0);
});

test('the version guard refuses anything that does not advance, and allows rc to stable', () => {
  const tags = ['@sdks@2.1.0', '@sdks@2.2.0-rc.1'];
  const base = { currentVersion: '2.2.0-rc.1', tags };
  assert.deepEqual(versionAdvanceErrors({ version: '2.2.0', ...base }), []);
  assert.deepEqual(versionAdvanceErrors({ version: '2.2.0-rc.2', ...base }), []);
  assert.deepEqual(versionAdvanceErrors({ version: 'v2.3', ...base }), [
    'v2.3 is not a valid version; expected X.Y.Z or X.Y.Z-rc.N',
  ]);
  assert.deepEqual(versionAdvanceErrors({ version: '', ...base }), [
    '(empty) is not a valid version; expected X.Y.Z or X.Y.Z-rc.N',
  ]);
  assert.ok(
    versionAdvanceErrors({ version: '2.1.5', ...base }).includes(
      '2.1.5 does not advance the current version 2.2.0-rc.1',
    ),
  );
  assert.ok(versionAdvanceErrors({ version: '2.2.0-rc.1', ...base }).includes('tag @sdks@2.2.0-rc.1 already exists'));
  assert.deepEqual(
    versionAdvanceErrors({ version: '1.0.1', currentVersion: '1.0.0', tags: [], requireTagAdvance: false }),
    [],
  );
});

// Grammatical but unencodable: without this the guard passes and bump-versions.sh fails instead,
// after release-notes.md is on disk. config-version.test.mjs owns the full message table.
test('the version guard refuses what the encoding cannot carry', () => {
  const base = { currentVersion: '2.2.0-rc.1', tags: ['@sdks@2.2.0-rc.1'] };
  const unencodable = [
    ['2.100.0', 'minor 100 outside 0..99'],
    ['2.2.100', 'patch 100 outside 0..99 (bump the minor instead)'],
    ['2.2.0-rc.99', 'rc 99 outside 0..98 (99 is reserved for stable)'],
    ['100.0.0', 'major 100 outside 1..99'],
  ];
  for (const [version, message] of unencodable) {
    assert.deepEqual(versionAdvanceErrors({ version, ...base }), [`${version} cannot be encoded: ${message}`], version);
  }
  assert.deepEqual(
    versionAdvanceErrors({ version: '0.0.1', currentVersion: '0.0.0', tags: [], requireTagAdvance: false }),
    ['0.0.1 cannot be encoded: major 0 outside 1..99'],
  );
});

test('a backport tag blocks the version it already published, and raises the floor', () => {
  const tags = ['@sdks@2.1.0'];
  const packageTags = ['@sodax/sdk@2.1.1'];
  assert.deepEqual(versionAdvanceErrors({ version: '2.1.1', currentVersion: '2.1.0', tags, packageTags }), [
    '@sodax/sdk@2.1.1 already published 2.1.1 to npm',
    '2.1.1 does not advance the published version 2.1.1',
  ]);
  // The unified flow may not reuse a version any single package already burned.
  assert.deepEqual(versionAdvanceErrors({ version: '2.1.2', currentVersion: '2.1.0', tags, packageTags }), []);
  assert.deepEqual(
    versionAdvanceErrors({ version: '2.2.0', currentVersion: '2.1.0', tags, packageTags: ['@sodax/skills@3.0.0'] }),
    ['2.2.0 does not advance the published version 3.0.0'],
  );
  assert.deepEqual(versionAdvanceErrors({ version: '2.2.0', currentVersion: '2.1.0', tags }), []);
});

test('package tags are parsed apart from unified tags and ignored when malformed', () => {
  assert.equal(parsePackageTag('@sodax/wallet-sdk-core@2.1.0')?.version, '2.1.0');
  assert.equal(parsePackageTag('@sodax/sdk@2.2.0-rc.3')?.version, '2.2.0-rc.3');
  assert.equal(parsePackageTag('@sdks@2.1.0'), null, 'the unified family is not a package tag');
  assert.equal(parsePackageTag('@sodax/sdk@not-a-version'), null);
  assert.equal(parseSdksTag('@sodax/sdk@2.1.0'), null, 'a package tag never anchors the notes range');
});

test('commits group by conventional type, including a body-only breaking footer', () => {
  const group = (subject, body = '') => commitGroup({ subject, commitBody: body });
  assert.equal(group('feat(sdk)!: drop the old API (#1)'), 'Breaking changes');
  assert.equal(group('fix(sdk)!: change a shape'), 'Breaking changes');
  assert.equal(group('feat(sdk): add a helper', 'BREAKING CHANGE: the quote shape moved'), 'Breaking changes');
  assert.equal(group('feat(sdk): add a helper'), 'Features');
  assert.equal(group('fix: correct a rounding error'), 'Fixes');
  assert.equal(group('chore(deps): bump a dependency'), 'Maintenance');
  assert.equal(group('no conventional prefix here'), 'Maintenance');
  assert.equal(
    group('feat(sdk): add a helper', 'BREAKING-CHANGE: the hyphenated spelling counts too'),
    'Breaking changes',
  );
  assert.equal(group('docs: mention BREAKING CHANGE in prose, not as a footer'), 'Maintenance');
});

test('release notes rebuild PR links from the subject and fall back to a short sha', () => {
  const commits = [
    { sha: '1'.repeat(40), subject: 'feat(sdk): add a helper (#403)', author: 'gcranju', commitBody: '' },
    { sha: '2'.repeat(40), subject: 'fix: repair a thing', author: '', commitBody: '' },
  ];
  const notes = renderNotes({
    version: '2.2.0',
    repo: 'icon-project/sodax-sdks',
    baseTag: '@sdks@2.1.0',
    commits,
    releaseOnly: [{ sha: '3'.repeat(40), subject: 'fix(sdk): hotfix', author: 'dev', commitBody: '' }],
  });
  assert.match(notes, /^## @sdks@2\.2\.0/);
  assert.match(notes, /npm dist-tag: latest/);
  assert.match(
    notes,
    /- feat\(sdk\): add a helper \(\[#403\]\(https:\/\/github\.com\/icon-project\/sodax-sdks\/pull\/403\)\) — gcranju/,
  );
  assert.match(notes, /- fix: repair a thing \(`22222222`\)/);
  assert.match(notes, /### Release-branch changes/);
  assert.match(notes, /compare\/@sdks@2\.1\.0\.\.\.@sdks@2\.2\.0/);
  assert.match(renderNotes({ version: '2.2.0-rc.2', repo: 'o/r', baseTag: null, commits: [] }), /npm dist-tag: rc/);
});

test('subjects are sanitised without mangling ordinary punctuation', () => {
  assert.equal(sanitizeSubject('feat(sdk): add a helper (#403)'), 'feat(sdk): add a helper');
  assert.equal(sanitizeSubject('fix: handle non-EVM chains'), 'fix: handle non-EVM chains');
  assert.equal(
    sanitizeSubject('feat: support [brackets] and <angles>'),
    'feat: support \\[brackets\\] and \\<angles\\>',
  );
});

test('log records survive multi-line bodies and tab-free field splitting', () => {
  const parsed = parseLog(
    `${commitRecord('1'.repeat(40), 'feat: one', 'dev', 'line one\nline two')}${commitRecord('2'.repeat(40), 'fix: two')}`,
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].subject, 'feat: one');
  assert.equal(parsed[0].commitBody, 'line one\nline two');
  assert.equal(parsed[1].author, 'dev');
});

test('porcelain paths keep their first character and the remote parser handles both URL forms', () => {
  assert.deepEqual(
    porcelainEntries(' M release-notes.md\n?? packages/sdk/CHANGELOG.md\n').map(entry => entry.path),
    ['release-notes.md', 'packages/sdk/CHANGELOG.md'],
  );
  assert.equal(parseRemoteRepo('git@github.com:icon-project/sodax-sdks.git'), 'icon-project/sodax-sdks');
  assert.equal(parseRemoteRepo('https://github.com/icon-project/sodax-sdks.git'), 'icon-project/sodax-sdks');
});

test('the real bump script and publish workflow package lists match the real workspace', () => {
  const packages = discoverPublishablePackages(REPO_ROOT);
  assert.deepEqual(packageListErrors(REPO_ROOT, packages), []);
  assert.equal(packageListsIn(REPO_ROOT, '.github/workflows/sdks-publish.yml').length, 2);
  assert.equal(packageListsIn(REPO_ROOT, 'scripts/nope.sh'), null);
});

test('a missing publish workflow is refused, because the @sdks@ tag would trigger nothing', t => {
  const root = createWorkspace(t);
  rmSync(join(root, '.github/workflows/sdks-publish.yml'));
  assert.deepEqual(packageListErrors(root, discoverPublishablePackages(root)), [
    '.github/workflows/sdks-publish.yml is missing',
  ]);
});

test('a package list that drifts from the workspace is rejected', t => {
  const root = createWorkspace(t);
  writeFileSync(join(root, 'scripts/bump-versions.sh'), 'PACKAGES=(types sdk)\n');
  const errors = packageListErrors(root, discoverPublishablePackages(root));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^scripts\/bump-versions\.sh package list does not match/);
});

test('package discovery skips private packages and rejects malformed manifests', t => {
  const root = createWorkspace(t, ['types', 'sdk']);
  mkdirSync(join(root, 'packages/assets'), { recursive: true });
  writeJson(join(root, 'packages/assets/package.json'), { name: '@sodax/assets', version: '1.0.0', private: true });
  assert.deepEqual(Object.keys(discoverPublishablePackages(root)), ['@sodax/sdk', '@sodax/types']);

  writeJson(join(root, 'packages/sdk/package.json'), { name: '@sodax/sdk', version: 'nope' });
  assert.throws(() => discoverPublishablePackages(root), /invalid version nope/);
});

test('preflight refuses the wrong branch, a dirty tree, and unmerged main', async t => {
  const root = createWorkspace(t);
  await assert.rejects(run(root, { stub: { branch: 'main' } }), /current branch is main, expected release/);
  await assert.rejects(run(root, { stub: { status: [' M packages/sdk/package.json'] } }), /working tree must be clean/);

  const execGit = args => {
    if (args.join(' ') === `rev-list --count ${MAIN}..origin/main`) return '3\n';
    return gitStub()(args);
  };
  await assert.rejects(run(root, { execGit }), /origin\/main is not fully merged into HEAD/);
});

test('preflight refuses a stale origin/main rather than trusting a local ref', async t => {
  const root = createWorkspace(t);
  await assert.rejects(
    run(root, { stub: { remoteMain: 'f'.repeat(40) } }),
    /origin\/main is stale; run: git fetch origin --tags/,
  );
});

test('preflight refuses a stale release branch, so a bump never starts from the wrong base', async t => {
  const root = createWorkspace(t);
  await assert.rejects(
    run(root, { stub: { remoteRelease: 'f'.repeat(40) } }),
    /origin\/release is stale; run: git fetch origin --tags/,
  );
  await assert.rejects(
    run(root, { stub: { headContains: { 'origin/release': 2, '@sdks@2.2.0-rc.1': 0 } } }),
    /HEAD is behind origin\/release/,
  );
});

test('preflight refuses a branch that has current main but not the newest release tag', async t => {
  const root = createWorkspace(t);
  await assert.rejects(
    run(root, { stub: { headContains: { 'origin/release': 0, '@sdks@2.2.0-rc.1': 1 } } }),
    /HEAD does not contain @sdks@2\.2\.0-rc\.1/,
  );
});

test('a repository with no release branch yet skips the release-branch checks', async t => {
  const root = createWorkspace(t, ALL_DIRS, '1.0.0');
  const result = await run(root, { stub: { remoteRelease: '', tags: [] }, version: '1.0.1' });
  assert.equal(result.version, '1.0.1');
});

test('the notes range anchors on the newest stable tag, not the newest tag of any kind', async t => {
  const root = createWorkspace(t);
  const calls = [];
  await run(root, { stub: { calls, log: commitRecord('1'.repeat(40), 'feat: a thing (#1)') }, version: '2.2.0' });

  assert.ok(
    calls.includes('merge-base origin/main @sdks@2.1.0'),
    `expected the range to anchor on @sdks@2.1.0, calls were: ${calls.join(' | ')}`,
  );
  assert.ok(!calls.some(call => call.includes('merge-base origin/main @sdks@2.2.0-rc.1')));
});

test('with no tags at all the range falls back to the root commit and the tag guard relaxes', async t => {
  const root = createWorkspace(t, ALL_DIRS, '1.0.0');
  const calls = [];
  const result = await run(root, { stub: { calls, tags: [] }, version: '1.0.1' });

  assert.ok(calls.includes('rev-list --max-parents=0 origin/main'));
  assert.ok(
    calls.some(call => call.startsWith(`log --first-parent --reverse --format=`) && call.includes(ROOT_COMMIT)),
  );
  assert.equal(result.baseTag, null);
});

test('the preview lists commit subjects, not just counts, before the version is chosen', async t => {
  const root = createWorkspace(t);
  const lines = [];
  await run(root, {
    stub: {
      log: `${commitRecord('1'.repeat(40), 'feat(sdk): add getSwapSpeedTier (#280)')}${commitRecord('2'.repeat(40), 'fix: repair a thing (#403)')}`,
    },
    version: '2.2.0',
    log: message => lines.push(message),
  });
  const shown = lines.join('\n');
  const promptedAt = lines.findIndex(line => line.includes('Applied @sdks@'));

  assert.match(shown, /Features \(1\):\n    feat\(sdk\): add getSwapSpeedTier \(#280\)/);
  assert.match(shown, /Fixes \(1\):\n    fix: repair a thing \(#403\)/);
  assert.ok(
    lines.findIndex(line => line.includes('add getSwapSpeedTier')) < promptedAt,
    'subjects must be printed before the release is applied',
  );
});

test('preview subjects keep markdown characters readable', () => {
  assert.equal(
    previewSubject('feat: support [brackets] and <angles> (#1)'),
    'feat: support [brackets] and <angles> (#1)',
  );
  assert.equal(previewSubject('feat:  collapse\n\twhitespace'), 'feat: collapse whitespace');
});

test('an empty commit range is reported but does not abort the release', async t => {
  const root = createWorkspace(t);
  const lines = [];
  const result = await run(root, { stub: { log: '' }, version: '2.2.0', log: message => lines.push(message) });

  assert.equal(result.commits.length, 0);
  assert.ok(lines.some(line => line.includes('Commits:         0 (nothing new on main)')));
});

test('a supplied version that does not advance is refused before anything is written', async t => {
  const root = createWorkspace(t, ALL_DIRS, '2.2.0-rc.1');
  await assert.rejects(run(root, { version: '2.1.5' }), error => {
    assert.ok(error instanceof ReleaseError);
    assert.ok(error.errors.includes('2.1.5 does not advance the current version 2.2.0-rc.1'));
    return true;
  });
  assert.throws(() => readFileSync(join(root, 'release-notes.md')), /ENOENT/);
});

test('the prompt re-asks after a rejected version and applies the accepted one', async t => {
  const root = createWorkspace(t);
  const answers = ['2.0.5', 'not-a-version', '2.2.0'];
  const asked = [];
  const result = await run(root, {
    prompt: async question => {
      asked.push(question);
      return answers.shift();
    },
  });

  assert.deepEqual(asked, ['New version: ', 'New version: ', 'New version: ']);
  assert.equal(result.version, '2.2.0');
});

test('an unencodable version is re-prompted, not left for the bump to reject', async t => {
  const root = createWorkspace(t);
  const answers = ['2.100.0', '2.2.0'];
  const shown = [];
  const result = await run(root, {
    prompt: async () => answers.shift(),
    log: line => shown.push(line),
  });

  assert.equal(result.version, '2.2.0');
  assert.ok(shown.some(line => line.includes('2.100.0 cannot be encoded: minor 100 outside 0..99')));
});

test('an unencodable version passed as an argument is refused before the notes are written', async t => {
  const root = createWorkspace(t);
  await assert.rejects(run(root, { version: '2.2.100' }), error => {
    assert.ok(error instanceof ReleaseError);
    assert.ok(error.errors.includes('2.2.100 cannot be encoded: patch 100 outside 0..99 (bump the minor instead)'));
    return true;
  });
  assert.throws(() => readFileSync(join(root, 'release-notes.md')), /ENOENT/);
  for (const directory of ALL_DIRS) {
    assert.equal(JSON.parse(readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8')).version, '2.1.0');
  }
});

test('the prompt gives up after three rejected versions', async t => {
  const root = createWorkspace(t);
  await assert.rejects(run(root, { prompt: async () => '2.0.5' }), error => {
    assert.ok(error instanceof ReleaseError);
    return true;
  });
});

test('a backport published outside the unified flow is refused before anything is written', async t => {
  const root = createWorkspace(t, ALL_DIRS, '2.1.0');
  await assert.rejects(
    run(root, {
      stub: { tags: ['@sdks@2.1.0'], packageTags: ['@sodax/sdk@2.2.0'], headContains: { 'origin/release': 0 } },
      version: '2.2.0',
    }),
    /@sodax\/sdk@2\.2\.0 already published 2\.2\.0 to npm/,
  );
  for (const directory of ALL_DIRS) {
    assert.equal(
      JSON.parse(readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8')).version,
      '2.1.0',
      'the guard runs before the bump',
    );
  }
  assert.ok(!existsSync(join(root, 'release-notes.md')));
});

test('a bump that touches unexpected files is refused', async t => {
  const root = createWorkspace(t);
  const status = ['', `${porcelainFor(ALL_DIRS)}\n M pnpm-lock.yaml`];
  await assert.rejects(run(root, { stub: { status }, version: '2.2.0' }), error => {
    assert.ok(error.errors.some(message => message.startsWith('the version bump changed unexpected files')));
    assert.ok(error.errors.some(message => message.includes('pnpm-lock.yaml')));
    return true;
  });
});

test('end-to-end run bumps every package, writes notes, and never invokes pnpm', {
  skip: process.platform === 'win32',
}, async t => {
  const root = createWorkspace(t, ALL_DIRS, '2.1.0');
  copyReleaseScripts(root);

  const commands = [];
  const lines = [];
  const result = await run(root, {
    stub: {
      status: ['', porcelainFor(ALL_DIRS)],
      log: `${commitRecord('1'.repeat(40), 'feat(sdk): add a helper (#403)', 'gcranju')}${commitRecord('2'.repeat(40), 'fix(sdk)!: change a shape (#404)', 'dev')}`,
    },
    version: '2.2.0',
    runCommand: (command, args, options) => {
      commands.push([command, ...args]);
      return execFileSync(command, args, { cwd: options.cwd, encoding: 'utf8' });
    },
    log: message => lines.push(message),
  });

  assert.deepEqual(commands, [['bash', 'scripts/bump-versions.sh', '2.2.0']]);
  for (const directory of ALL_DIRS) {
    assert.equal(JSON.parse(readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8')).version, '2.2.0');
  }
  assert.match(
    readFileSync(join(root, 'packages/types/src/index.ts'), 'utf8'),
    new RegExp(`CONFIG_VERSION = ${configVersionForOrThrow('2.2.0')};`),
  );

  const notes = readFileSync(join(root, 'release-notes.md'), 'utf8');
  assert.match(notes, /## @sdks@2\.2\.0/);
  assert.match(notes, /### Breaking changes\n\n- fix\(sdk\)!: change a shape/);
  assert.match(notes, /### Features\n\n- feat\(sdk\): add a helper/);
  assert.equal(result.tag, '@sdks@2.2.0');
  assert.ok(lines.some(line => line.includes('git commit -m "chore: release @sdks@2.2.0"')));
  assert.ok(!lines.some(line => line.includes('--prerelease')));
});

test('an rc version prints the prerelease flag in the handoff', {
  skip: process.platform === 'win32',
}, async t => {
  const root = createWorkspace(t, ALL_DIRS, '2.1.0');
  copyReleaseScripts(root);
  const lines = [];
  await run(root, {
    stub: { status: ['', porcelainFor(ALL_DIRS)] },
    version: '2.2.0-rc.2',
    runCommand: (command, args, options) => execFileSync(command, args, { cwd: options.cwd, encoding: 'utf8' }),
    log: message => lines.push(message),
  });
  assert.ok(lines.some(line => line.includes('--prerelease')));
  assert.ok(lines.some(line => line.includes('npm deprecate @sodax/libs@2.2.0-rc.2')));
});

test('argument parsing accepts a single optional version', () => {
  assert.deepEqual(parseReleaseArgs([]), { version: null });
  assert.deepEqual(parseReleaseArgs(['--', '2.2.0']), { version: '2.2.0' });
  assert.throws(() => parseReleaseArgs(['--dry-run']), /unknown argument --dry-run/);
  assert.throws(() => parseReleaseArgs(['2.2.0', '2.3.0']), /unexpected arguments: 2\.3\.0/);
});

// Exercises the real pathspec against a real repository: a stubbed log would hide a pathspec that matches nothing.
const FIXTURE_IDENTITY = {
  // git exports these into hook environments, where they would outrank the fixture's own config.
  GIT_AUTHOR_NAME: 'release',
  GIT_AUTHOR_EMAIL: 'release@sodax.test',
  GIT_COMMITTER_NAME: 'release',
  GIT_COMMITTER_EMAIL: 'release@sodax.test',
};

const repoCommands = root => {
  const env = { ...process.env, ...FIXTURE_IDENTITY };
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env });
  return {
    git,
    sha: ref => git('rev-parse', ref).trim(),
    commit: subject => {
      git('add', '-A');
      git('commit', '-q', '--no-verify', '-m', subject);
    },
    src: (path, body) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    },
  };
};

const gitFixture = root => {
  const { git, sha, commit } = repoCommands(root);
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'git@github.com:icon-project/sodax-sdks.git');
  commit('chore: scaffold');
  git('tag', '@sdks@2.1.0');

  mkdirSync(join(root, 'packages/sdk/src'), { recursive: true });
  writeFileSync(join(root, 'packages/sdk/src/index.ts'), 'export const helper = () => 1;\n');
  commit('feat(sdk): add a helper (#411)');
  const main = sha('HEAD');
  git('update-ref', 'refs/remotes/origin/main', main);

  git('checkout', '-q', '-b', 'release');
  mkdirSync(join(root, 'packages/sdk/src/services'), { recursive: true });
  writeFileSync(join(root, 'packages/sdk/src/services/relay.ts'), 'export const relay = () => 2;\n');
  commit('fix(sdk): patch the relay client');
  writeFileSync(join(root, 'packages/sdk/README.md'), 'docs only\n');
  commit('docs(sdk): release-branch readme touch-up');
  writeFileSync(
    join(root, 'packages/types/src/index.ts'),
    `export const CONFIG_VERSION = ${configVersionForOrThrow('2.2.0-rc.1')}; // 2.2.0-rc.1\n`,
  );
  commit('chore: bump CONFIG_VERSION on release');
  git('update-ref', 'refs/remotes/origin/release', sha('HEAD'));
  return { main, release: sha('HEAD') };
};

// Only the network-bound lookups are stubbed; every other call runs against the fixture repository.
const fixtureGit =
  ({ main, release }, tags = ['@sdks@2.1.0']) =>
  (args, options) => {
    const key = args.join(' ');
    if (key === 'ls-remote origin refs/heads/main') return `${main}\trefs/heads/main\n`;
    if (key === 'ls-remote origin refs/heads/release') return `${release}\trefs/heads/release\n`;
    if (key === 'ls-remote --tags origin @sdks@*') {
      return tags.map(tag => `${'c'.repeat(40)}\trefs/tags/${tag}`).join('\n');
    }
    if (key === 'ls-remote --tags origin @sodax/*@*') return '';
    return execFileSync('git', args, { cwd: options.cwd, encoding: 'utf8' });
  };

test('release-only source commits survive the real pathspec in the preview and the notes', {
  skip: process.platform === 'win32',
}, async t => {
  const root = createWorkspace(t, ALL_DIRS, '2.1.0');
  const refs = gitFixture(root);
  const lines = [];
  const result = await run(root, {
    execGit: fixtureGit(refs),
    version: '2.2.0',
    log: message => lines.push(message),
  });

  assert.deepEqual(
    result.releaseOnly.map(commit => commit.subject),
    ['fix(sdk): patch the relay client'],
    'only nested source commits count; the readme and CONFIG_VERSION commits are excluded',
  );
  assert.deepEqual(
    result.commits.map(commit => commit.subject),
    ['feat(sdk): add a helper (#411)'],
    'the main range is unaffected by the release-only pathspec',
  );

  assert.ok(
    lines.some(line => line.includes('Release-branch source commits (1)')),
    'the preview reports the release-only commit',
  );
  assert.ok(lines.some(line => line.includes('fix(sdk): patch the relay client')));

  const notes = readFileSync(join(root, 'release-notes.md'), 'utf8');
  assert.match(notes, /### Release-branch changes\n\n- fix\(sdk\): patch the relay client \(`[0-9a-f]{8}`\) — release/);
  assert.ok(!notes.includes('readme touch-up'), 'non-source release commits stay out of the notes');
});

// A hotfix that shipped in 2.1.0 stays reachable from HEAD forever, so only the stable anchor drops it.
const anchorFixture = root => {
  const { git, sha, commit, src } = repoCommands(root);
  git('init', '-q', '-b', 'main');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', 'git@github.com:icon-project/sodax-sdks.git');
  commit('chore: scaffold');

  git('checkout', '-q', '-b', 'release');
  src('packages/sdk/src/shipped.ts', 'export const shipped = 1;\n');
  commit('fix(sdk): hotfix shipped in 2.1.0');
  git('tag', '@sdks@2.1.0');

  git('checkout', '-q', 'main');
  src('packages/sdk/src/index.ts', 'export const helper = () => 1;\n');
  commit('feat(sdk): add a helper');
  const main = sha('HEAD');
  git('update-ref', 'refs/remotes/origin/main', main);

  git('checkout', '-q', 'release');
  git('merge', '-q', '--no-ff', 'main', '-m', 'Merge main into release');
  src('packages/sdk/src/after-stable.ts', 'export const afterStable = 2;\n');
  commit('fix(sdk): hotfix after 2.1.0');
  git('tag', '@sdks@2.2.0-rc.1');
  src('packages/sdk/src/after-rc.ts', 'export const afterRc = 3;\n');
  commit('fix(sdk): hotfix after rc.1');
  git('update-ref', 'refs/remotes/origin/release', sha('HEAD'));
  return { main, release: sha('HEAD') };
};

const subjectsFor = async (t, tags) => {
  const root = createWorkspace(t, ALL_DIRS, '2.1.0');
  const refs = anchorFixture(root);
  const result = await run(root, { execGit: fixtureGit(refs, tags), version: '2.2.0' });
  return { subjects: result.releaseOnly.map(commit => commit.subject), root };
};

test('a release-only hotfix drops out of the next stable notes once it has shipped', {
  skip: process.platform === 'win32',
}, async t => {
  const { subjects, root } = await subjectsFor(t, ['@sdks@2.1.0']);
  assert.deepEqual(subjects, ['fix(sdk): hotfix after rc.1', 'fix(sdk): hotfix after 2.1.0']);
  assert.ok(!subjects.includes('fix(sdk): hotfix shipped in 2.1.0'), 'it already shipped in @sdks@2.1.0');
  assert.ok(!readFileSync(join(root, 'release-notes.md'), 'utf8').includes('shipped in 2.1.0'));
});

test('rc notes stay cumulative: the anchor is the newest stable tag, not the newest rc', {
  skip: process.platform === 'win32',
}, async t => {
  const { subjects } = await subjectsFor(t, ['@sdks@2.1.0', '@sdks@2.2.0-rc.1']);
  assert.deepEqual(
    subjects,
    ['fix(sdk): hotfix after rc.1', 'fix(sdk): hotfix after 2.1.0'],
    'the commit already carried by rc.1 is still listed, because rc notes span the last stable release',
  );
});

test('with no stable tag the release-only range keeps its unanchored fallback', {
  skip: process.platform === 'win32',
}, async t => {
  const { subjects } = await subjectsFor(t, []);
  assert.deepEqual(subjects, [
    'fix(sdk): hotfix after rc.1',
    'fix(sdk): hotfix after 2.1.0',
    'fix(sdk): hotfix shipped in 2.1.0',
  ]);
});
