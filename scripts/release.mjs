import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  configVersionErrors,
  configVersionForOrThrow,
  decodeConfigVersion,
  parseVersion,
  readConfigVersion,
} from './config-version.mjs';

// Re-exported: config-version.mjs owns the version grammar, but these are long-standing release.mjs
// exports and its tests import them from here.
export { compareVersions, parseVersion };

const SDK_TAG_PATTERN = /^@sdks@(.+)$/;
const PACKAGE_TAG_PATTERN = /^@sodax\/[^@]+@(.+)$/;
const PR_SUFFIX_PATTERN = /\(#(\d+)\)$/;
const TYPE_PATTERN = /^([a-z]+)(?:\([^)]*\))?!?:/i;
const TITLE_BANG_PATTERN = /^[a-z]+(?:\([^)]*\))?!:/i;
const BREAKING_BODY_PATTERN = /^BREAKING[ -]CHANGE(?::|\s*$)/im;
const CONFIG_PATH = 'packages/types/src/index.ts';
const NOTES_PATH = 'release-notes.md';
const LOG_FORMAT = '%H%x1f%s%x1f%an%x1f%b%x1e';
const NOTE_GROUPS = ['Breaking changes', 'Features', 'Fixes', 'Maintenance'];
const VERSION_ATTEMPTS = 3;
const FETCH_HINT = 'run: git fetch origin --tags';

export class ReleaseError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.errors = errors;
  }
}

const fail = message => {
  throw new ReleaseError([message]);
};

export const parseSdksTag = tag => {
  const match = typeof tag === 'string' ? tag.match(SDK_TAG_PATTERN) : null;
  if (!match) return null;
  const parsed = parseVersion(match[1]);
  return parsed ? { tag, version: match[1], parsed } : null;
};

// Per-package backport tags publish into the same npm version namespace as the unified @sdks@ flow.
export const parsePackageTag = tag => {
  const match = typeof tag === 'string' ? tag.match(PACKAGE_TAG_PATTERN) : null;
  if (!match) return null;
  const parsed = parseVersion(match[1]);
  return parsed ? { tag, version: match[1], parsed } : null;
};

const maxTag = tags =>
  tags.reduce((best, tag) => (!best || compareVersions(tag.parsed, best.parsed) > 0 ? tag : best), null);

export const discoverPublishablePackages = workspaceRoot => {
  const packagesRoot = join(workspaceRoot, 'packages');
  const packages = {};

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesRoot, entry.name, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    if (manifest.private === true) continue;
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@sodax/')) {
      fail(`publishable manifest ${relative(workspaceRoot, manifestPath)} has no valid @sodax/* name`);
    }
    if (!parseVersion(manifest.version)) {
      fail(`publishable manifest ${relative(workspaceRoot, manifestPath)} has invalid version ${manifest.version}`);
    }
    packages[manifest.name] = `packages/${entry.name}`;
  }

  return Object.fromEntries(Object.entries(packages).sort(([left], [right]) => left.localeCompare(right)));
};

export const readAlignedVersion = (workspaceRoot, packages) => {
  const versions = Object.entries(packages).map(([name, directory]) => [
    name,
    JSON.parse(readFileSync(join(workspaceRoot, directory, 'package.json'), 'utf8')).version,
  ]);
  if (new Set(versions.map(([, version]) => version)).size !== 1) {
    fail(`publishable package versions are not aligned: ${versions.map(([n, v]) => `${n}=${v}`).join(', ')}`);
  }
  return versions[0][1];
};

const defaultCommand = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'pipe',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status}`);
  }
  return result.stdout ?? '';
};

const defaultGit = (args, options = {}) => defaultCommand('git', args, options);

const defaultPrompt = async question => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

const splitLines = value =>
  String(value)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

// Porcelain paths start at column 3, so the status columns must survive trimming.
export const porcelainEntries = value =>
  String(value)
    .split(/\r?\n/)
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => line !== '')
    .map(line => ({ line: line.trim(), path: line.slice(3).replace(/^"|"$/g, '') }));

export const parseRemoteRepo = remote => {
  const trimmed = String(remote)
    .trim()
    .replace(/\.git$/, '');
  return trimmed.match(/(?:github\.com[/:])([^/]+\/[^/]+)$/)?.[1] ?? 'icon-project/sodax-sdks';
};

export const parseLog = output =>
  String(output)
    .split('\x1e')
    .map(record => record.replace(/^\r?\n/, ''))
    .filter(record => record.trim() !== '')
    .map(record => {
      const [sha = '', subject = '', author = '', ...bodyParts] = record.split('\x1f');
      return {
        sha: sha.trim(),
        subject,
        author: author.trim(),
        commitBody: bodyParts.join('\x1f').replace(/\r?\n$/, ''),
      };
    });

export const commitGroup = commit => {
  if (TITLE_BANG_PATTERN.test(commit.subject) || BREAKING_BODY_PATTERN.test(commit.commitBody ?? '')) {
    return 'Breaking changes';
  }
  const type = commit.subject.match(TYPE_PATTERN)?.[1]?.toLowerCase();
  if (type === 'feat') return 'Features';
  if (type === 'fix') return 'Fixes';
  return 'Maintenance';
};

export const sanitizeSubject = subject =>
  String(subject)
    .replace(/\s*\(#\d+\)$/, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\\[\]<>]/g, '\\$&')
    .trim();

// Terminal preview: collapse control characters but leave markdown unescaped, unlike sanitizeSubject.
export const previewSubject = subject =>
  String(subject)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const commitBullet = (commit, repo) => {
  const subject = sanitizeSubject(commit.subject);
  const author = commit.author ? ` — ${commit.author}` : '';
  const pr = commit.subject.match(PR_SUFFIX_PATTERN)?.[1];
  if (!pr) return `- ${subject} (\`${commit.sha.slice(0, 8)}\`)${author}`;
  return `- ${subject} ([#${pr}](https://github.com/${repo}/pull/${pr}))${author}`;
};

export const renderNotes = ({ version, repo, baseTag, commits, releaseOnly = [] }) => {
  const lines = [
    `## @sdks@${version}`,
    '',
    `${commits.length} commit(s) since ${baseTag ?? 'the start of history'}.`,
    `npm dist-tag: ${version.includes('-rc.') ? 'rc' : 'latest'}`,
  ];
  for (const group of NOTE_GROUPS) {
    const items = commits.filter(commit => commitGroup(commit) === group);
    if (items.length === 0) continue;
    lines.push('', `### ${group}`, '', ...items.map(commit => commitBullet(commit, repo)));
  }
  if (releaseOnly.length > 0) {
    lines.push('', '### Release-branch changes', '', ...releaseOnly.map(commit => commitBullet(commit, repo)));
  }
  if (baseTag) lines.push('', `[Compare changes](https://github.com/${repo}/compare/${baseTag}...@sdks@${version})`);
  lines.push('');
  return lines.join('\n');
};

const parsePackageList = body =>
  body
    .split(/\s+/)
    .map(value => value.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .sort();

export const packageListsIn = (workspaceRoot, path) => {
  const absolute = join(workspaceRoot, path);
  if (!existsSync(absolute)) return null;
  const lists = [...readFileSync(absolute, 'utf8').matchAll(/PACKAGES=\(([^)]*)\)/gs)];
  return lists.length > 0 ? lists.map(match => parsePackageList(match[1])) : [];
};

// bump-versions.sh and sdks-publish.yml each hardcode the package list; nothing else keeps them honest.
export const packageListErrors = (workspaceRoot, packages) => {
  const expected = Object.values(packages)
    .map(directory => basename(directory))
    .sort();
  const errors = [];
  for (const { path, required } of [
    { path: 'scripts/bump-versions.sh', required: true },
    { path: '.github/workflows/sdks-publish.yml', required: true },
  ]) {
    const lists = packageListsIn(workspaceRoot, path);
    if (lists === null) {
      if (required) errors.push(`${path} is missing`);
      continue;
    }
    if (lists.length === 0) errors.push(`${path} has no readable PACKAGES=(...) list`);
    else if (lists.some(list => list.join('\0') !== expected.join('\0'))) {
      errors.push(`${path} package list does not match publishable packages (${expected.join(' ')})`);
    }
  }
  return errors;
};

const highestTagVersion = parsed =>
  parsed
    .filter(Boolean)
    .reduce((best, tag) => (best === null || compareVersions(tag.version, best) > 0 ? tag.version : best), null);

export const versionAdvanceErrors = ({ version, currentVersion, tags, packageTags = [], requireTagAdvance = true }) => {
  if (!parseVersion(version)) return [`${version || '(empty)'} is not a valid version; expected X.Y.Z or X.Y.Z-rc.N`];
  // The field limits belong here, not only in the bump: past this guard the notes file is written.
  const errors = [...configVersionErrors(version)];
  if (tags.includes(`@sdks@${version}`)) errors.push(`tag @sdks@${version} already exists`);
  // The unified flow republishes every package, so one backported tag makes the whole version unusable.
  const claimed = packageTags.find(tag => parsePackageTag(tag)?.version === version);
  if (claimed) errors.push(`${claimed} already published ${version} to npm`);
  if (parseVersion(currentVersion) && compareVersions(version, currentVersion) <= 0) {
    errors.push(`${version} does not advance the current version ${currentVersion}`);
  }
  const highest = highestTagVersion([...tags.map(parseSdksTag), ...packageTags.map(parsePackageTag)]);
  if (requireTagAdvance && highest && compareVersions(version, highest) <= 0) {
    errors.push(`${version} does not advance the published version ${highest}`);
  }
  return errors;
};

const remoteHead = (git, ref) => splitLines(git(['ls-remote', 'origin', ref]))[0]?.split(/\s+/)[0] ?? '';

// Zero commits reachable from ref but not HEAD means HEAD already contains it.
const headContains = (git, ref) => Number(git(['rev-list', '--count', `HEAD..${ref}`]).trim()) === 0;

const remoteTags = (git, pattern) =>
  [
    ...new Set(
      splitLines(git(['ls-remote', '--tags', 'origin', pattern]))
        .map(line => line.split(/\s+/)[1] ?? '')
        .map(ref => ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''))
        .filter(Boolean),
    ),
  ].sort();

const remoteSdksTags = git => remoteTags(git, '@sdks@*');
const remotePackageTags = git => remoteTags(git, '@sodax/*@*');

const worktreePaths = git => porcelainEntries(git(['status', '--porcelain']));

const expectedMutationScope = packages =>
  [...Object.values(packages).map(directory => `${directory}/package.json`), CONFIG_PATH].sort();

// Assert what actually moved rather than trusting the bump script's unanchored seds.
const verifyMutation = (git, workspaceRoot, packages, version) => {
  const actual = worktreePaths(git)
    .map(entry => entry.path)
    .filter(path => path !== NOTES_PATH)
    .sort();
  const expected = expectedMutationScope(packages);
  const errors = [];
  if (actual.join('\0') !== expected.join('\0')) {
    errors.push(
      `the version bump changed unexpected files (expected exactly ${expected.length})`,
      `expected: ${expected.join(', ')}`,
      `actual:   ${actual.join(', ') || '(none)'}`,
    );
  }
  for (const [name, directory] of Object.entries(packages)) {
    const manifest = JSON.parse(readFileSync(join(workspaceRoot, directory, 'package.json'), 'utf8'));
    if (manifest.version !== version) errors.push(`${name} is ${manifest.version}, expected ${version}`);
  }
  // The bump script derives this; assert the value that actually landed, not just that the file moved.
  const expectedConfigVersion = configVersionForOrThrow(version);
  const actualConfigVersion = readConfigVersion(workspaceRoot);
  if (actualConfigVersion !== expectedConfigVersion) {
    errors.push(
      `CONFIG_VERSION is ${actualConfigVersion} (${decodeConfigVersion(actualConfigVersion) ?? 'not a config version'}), expected ${expectedConfigVersion} for ${version}`,
    );
  }
  if (errors.length > 0) throw new ReleaseError(errors);
};

export const cutRelease = async ({
  workspaceRoot = process.cwd(),
  version = null,
  execGit = defaultGit,
  runCommand = defaultCommand,
  prompt = defaultPrompt,
  log = console.log,
} = {}) => {
  const git = args => execGit(args, { cwd: workspaceRoot });

  const branch = git(['branch', '--show-current']).trim();
  if (branch !== 'release') fail(`current branch is ${branch || '(detached)'}, expected release`);

  const dirty = worktreePaths(git).filter(entry => entry.path !== NOTES_PATH);
  if (dirty.length > 0) fail(`working tree must be clean: ${dirty.map(entry => entry.line).join(', ')}`);

  const localMain = git(['rev-parse', 'origin/main']).trim();
  const remoteMain = remoteHead(git, 'refs/heads/main');
  if (remoteMain && remoteMain !== localMain) fail(`origin/main is stale; ${FETCH_HINT}`);

  // A stale release branch would bump from the wrong base, cutting the wrong version and writing
  // release notes against it. CONFIG_VERSION itself is safe — it is derived from the version now.
  const remoteRelease = remoteHead(git, 'refs/heads/release');
  if (remoteRelease) {
    let localRelease = '';
    try {
      localRelease = git(['rev-parse', 'origin/release']).trim();
    } catch {
      fail(`origin/release is not available locally; ${FETCH_HINT}`);
    }
    if (localRelease !== remoteRelease) fail(`origin/release is stale; ${FETCH_HINT}`);
    if (!headContains(git, 'origin/release')) {
      fail(`HEAD is behind origin/release; ${FETCH_HINT} and fast-forward release before releasing`);
    }
  }

  const mainBase = git(['merge-base', 'origin/main', 'HEAD']).trim();
  const unmerged = Number(git(['rev-list', '--count', `${mainBase}..origin/main`]).trim());
  if (!Number.isSafeInteger(unmerged) || unmerged !== 0) fail('origin/main is not fully merged into HEAD');

  const packages = discoverPublishablePackages(workspaceRoot);
  const currentVersion = readAlignedVersion(workspaceRoot, packages);
  const listErrors = packageListErrors(workspaceRoot, packages);
  if (listErrors.length > 0) throw new ReleaseError(listErrors);

  const tags = remoteSdksTags(git);
  const packageTags = remotePackageTags(git);
  const parsedTags = tags.map(parseSdksTag).filter(Boolean);
  // Two anchors: notes span the last stable release, the version guard uses the newest tag of any kind.
  const baseTag = maxTag(parsedTags.filter(tag => tag.parsed.rc === null));
  const lastTag = maxTag(parsedTags);

  if (lastTag) {
    let contained;
    try {
      contained = headContains(git, lastTag.tag);
    } catch {
      fail(`${lastTag.tag} is not available locally; ${FETCH_HINT}`);
    }
    if (!contained) fail(`HEAD does not contain ${lastTag.tag}; ${FETCH_HINT} and update release before releasing`);
  }

  let rangeStart;
  if (baseTag) {
    try {
      rangeStart = git(['merge-base', 'origin/main', baseTag.tag]).trim();
    } catch {
      fail(`${baseTag.tag} is not available locally; ${FETCH_HINT}`);
    }
  } else {
    rangeStart = splitLines(git(['rev-list', '--max-parents=0', 'origin/main']))[0];
  }

  const commits = parseLog(
    git(['log', '--first-parent', '--reverse', `--format=${LOG_FORMAT}`, `${rangeStart}..${mainBase}`]),
  );
  // Anchored on the same stable tag as the main range, so shipped hotfixes drop out but rc notes stay cumulative.
  const releaseOnly = parseLog(
    git([
      'log',
      '--no-merges',
      `--format=${LOG_FORMAT}`,
      `${mainBase}..HEAD`,
      ...(baseTag ? [`^${baseTag.tag}`] : []),
      '--',
      ':(glob)packages/*/src/**',
      `:(exclude)${CONFIG_PATH}`,
    ]),
  );

  log(`Current version: ${currentVersion}`);
  log(`Base tag:        ${baseTag?.tag ?? '(none - first release)'}`);
  if (lastTag && lastTag.tag !== baseTag?.tag) log(`Newest tag:      ${lastTag.tag}`);
  log(`Commits:         ${commits.length}${commits.length === 0 ? ' (nothing new on main)' : ''}`);
  for (const group of NOTE_GROUPS) {
    const items = commits.filter(commit => commitGroup(commit) === group);
    if (items.length === 0) continue;
    log('');
    log(`  ${group} (${items.length}):`);
    for (const commit of items) log(`    ${previewSubject(commit.subject)}`);
  }
  if (releaseOnly.length > 0) {
    log('');
    log(`  Release-branch source commits (${releaseOnly.length}):`);
    for (const commit of releaseOnly) log(`    ${previewSubject(commit.subject)}`);
  }
  log('');

  const guard = candidate =>
    versionAdvanceErrors({
      version: candidate,
      currentVersion,
      tags,
      packageTags,
      requireTagAdvance: Boolean(lastTag),
    });

  let target = null;
  if (version !== null) {
    const errors = guard(version);
    if (errors.length > 0) throw new ReleaseError(errors);
    target = version;
  } else {
    for (let attempt = 1; attempt <= VERSION_ATTEMPTS; attempt += 1) {
      const answer = (await prompt('New version: ')).trim();
      const errors = guard(answer);
      if (errors.length === 0) {
        target = answer;
        break;
      }
      for (const message of errors) log(`  ${message}`);
      if (attempt === VERSION_ATTEMPTS) throw new ReleaseError(errors);
    }
  }

  const repo = parseRemoteRepo(git(['remote', 'get-url', 'origin']));
  try {
    writeFileSync(
      join(workspaceRoot, NOTES_PATH),
      renderNotes({ version: target, repo, baseTag: baseTag?.tag ?? null, commits, releaseOnly }),
    );
    runCommand('bash', ['scripts/bump-versions.sh', target], { cwd: workspaceRoot, stdio: 'inherit' });
    verifyMutation(git, workspaceRoot, packages, target);
  } catch (error) {
    log('');
    log('Release aborted. Nothing was committed or tagged.');
    log('  git checkout -- packages/');
    log(`  rm -f ${NOTES_PATH}`);
    log('Then re-run: pnpm release');
    throw error;
  }

  const tag = `@sdks@${target}`;
  log('');
  log(`Applied ${tag}. Next steps:`);
  log('  git add packages/');
  log(`  git commit -m "chore: release ${tag}"`);
  log('  git push -u origin release');
  log('  gh auth status');
  log(
    `  gh release create "${tag}" --target release --title "${tag}" --notes-file release-notes.md${target.includes('-rc.') ? ' --prerelease' : ''}`,
  );
  log(`  npm deprecate @sodax/libs@${target} "Internal package - do not depend on directly."`);
  log('  Announce the release in the Venture 23 and Sodax Discord channels.');

  return { version: target, tag, baseTag: baseTag?.tag ?? null, commits, releaseOnly, packages };
};

export const parseReleaseArgs = args => {
  const positional = args.filter(argument => argument !== '--');
  if (positional.some(argument => argument.startsWith('-'))) {
    throw new ReleaseError([`unknown argument ${positional.find(argument => argument.startsWith('-'))}`]);
  }
  if (positional.length > 1) throw new ReleaseError([`unexpected arguments: ${positional.slice(1).join(' ')}`]);
  return { version: positional[0] ?? null };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { version } = parseReleaseArgs(process.argv.slice(2));
    await cutRelease({ workspaceRoot: process.cwd(), version });
  } catch (error) {
    const errors = error instanceof ReleaseError ? error.errors : [error.message];
    console.error('Release failed:');
    for (const message of errors) console.error(`- ${message}`);
    process.exitCode = 1;
  }
}
