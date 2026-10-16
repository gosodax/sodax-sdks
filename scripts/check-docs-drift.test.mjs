import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../.github/scripts/check-docs-drift.sh', import.meta.url));

const MAP = {
  mirrored: [
    { src: 'packages/sdk/docs/SWAPS.md', dest: 'developers/swaps.md' },
    { src: 'packages/sdk/README.md', dest: 'developers/sdk.md' },
    { src: 'packages/skills/README.md', dest: 'developers/skills.md' },
    { src: 'docs/guide.md', dest: 'developers/how-to/guide.md', pkgs: ['sdk'] },
    { src: 'docs/meta.md', dest: 'developers/meta.md' },
  ],
  unpublished: ['packages/sdk/docs/DEX.md'],
};

const mapWithUnpublished = (...paths) => ({ ...MAP, unpublished: [...MAP.unpublished, ...paths] });

const write = (root, path, content) => {
  mkdirSync(join(root, dirname(path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

const git = (root, args, opts = {}) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HUSKY: '0' },
    ...opts,
  }).trim();

const commit = (root, message) => {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
};

const createRepo = (t, { map = true, mapText = null } = {}) => {
  const root = mkdtempSync(join(fileURLToPath(new URL('..', import.meta.url)), '.tmp-docs-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const template = join(root, '.git-template');
  mkdirSync(join(template, 'hooks'), { recursive: true });
  git(root, ['init', '-b', 'main', `--template=${template}`]);
  if (map) {
    write(root, 'scripts/docs-pages-map.json', mapText ?? `${JSON.stringify(MAP, null, 2)}\n`);
  }
  write(root, 'packages/sdk/src/index.ts', 'export const n = 1;\n');
  write(root, 'packages/sdk/docs/SWAPS.md', '# Swaps\n');
  write(root, 'packages/sdk/docs/DEX.md', '# DEX\n');
  write(root, 'packages/sdk/notes/DRAFT.mdx', '# Draft\n');
  write(root, 'packages/sdk/README.md', '# sdk\n');
  write(root, 'packages/skills/README.md', '# skills\n');
  write(root, 'packages/types/src/index.ts', 'export type T = string;\n');
  write(root, 'packages/types/README.md', '# types\n');
  write(root, 'docs/guide.md', '# Guide\n');
  write(root, 'docs/meta.md', '# Meta\n');
  const base = commit(root, 'base');
  return { root, base };
};

const run = (root, base, head) => {
  try {
    const out = execFileSync('bash', [SCRIPT, base, head], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    return {
      code: error.status ?? 1,
      out: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
};

test('passes when no package src changed', t => {
  const { root, base } = createRepo(t);
  write(root, 'CONTRIBUTING.md', '# contrib\n');
  const head = commit(root, 'docs process');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('fails when sdk src changes with no docs', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  const head = commit(root, 'sdk src only');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
});

test('passes when sdk src changes with a mapped feature page', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'packages/sdk/docs/SWAPS.md', '# Swaps\n\nUpdated.\n');
  const head = commit(root, 'sdk + swaps.md');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs signal/);
});

test('fails when sdk src changes with an unrelated mapped README', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'packages/skills/README.md', '# skills\n\nUnrelated.\n');
  const head = commit(root, 'sdk + skills readme');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
  assert.match(result.out, /unrelated mapped file/);
});

test('passes when types src changes with a mapped sdk feature page', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/types/src/index.ts', 'export type T = number;\n');
  write(root, 'packages/sdk/docs/SWAPS.md', '# Swaps\n\nToken list.\n');
  const head = commit(root, 'types + swaps.md');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs signal/);
});

test('fails when a new sdk doc is not on the map', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'packages/sdk/docs/SWAPS.md', '# Swaps\n\nUpdated.\n');
  write(root, 'packages/sdk/docs/NEW.md', '# New\n');
  const head = commit(root, 'unmapped new page');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /not in scripts\/docs-pages-map.json/);
  assert.match(result.out, /packages\/sdk\/docs\/NEW.md/);
});

test('ignores test-only src changes', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.test.ts', 'test("n", () => {});\n');
  const head = commit(root, 'test only');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('fails when a docs-only PR adds an unmapped sdk page', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/docs/NEW.md', '# New\n');
  const head = commit(root, 'docs only unmapped');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /not in scripts\/docs-pages-map.json/);
  assert.match(result.out, /packages\/sdk\/docs\/NEW.md/);
});

test('passes when a docs-only PR adds an sdk page that is on the map', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/docs/NEW.md', '# New\n');
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(
      {
        mirrored: [...MAP.mirrored, { src: 'packages/sdk/docs/NEW.md', dest: 'developers/new.md' }],
      },
      null,
      2,
    )}\n`,
  );
  const head = commit(root, 'docs only mapped');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('passes when a docs-only PR adds an sdk page listed as unpublished', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/docs/SPONSORING.md', '# Sponsoring\n');
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(mapWithUnpublished('packages/sdk/docs/SPONSORING.md'), null, 2)}\n`,
  );
  const head = commit(root, 'docs only unpublished');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('fails when a new sdk page is on neither the map nor the unpublished list', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/docs/NEW.md', '# New\n');
  const head = commit(root, 'docs only on neither list');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /not in scripts\/docs-pages-map.json/);
  assert.match(result.out, /packages\/sdk\/docs\/NEW.md/);
  assert.match(result.out, /Not ready to publish\? Add it to "unpublished"/);
});

test('passes when a page moved into packages/sdk/docs is listed as unpublished', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'packages/sdk/notes/DRAFT.mdx', 'packages/sdk/docs/DRAFT.mdx']);
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(mapWithUnpublished('packages/sdk/docs/DRAFT.mdx'), null, 2)}\n`,
  );
  const head = commit(root, 'move draft in as unpublished');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('fails when a map pkgs entry names a package that does not exist', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'docs/guide.md', '# Guide\n\nUpdated.\n');
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(
      {
        ...MAP,
        mirrored: MAP.mirrored.map(item => (item.src === 'docs/guide.md' ? { ...item, pkgs: ['sdkk'] } : item)),
      },
      null,
      2,
    )}\n`,
  );
  const head = commit(root, 'pkgs names a missing package');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /names a package that does not exist: sdkk/);
});

test('fails when types src changes and the package README is deleted', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/types/src/index.ts', 'export type T = number;\n');
  unlinkSync(join(root, 'packages/types/README.md'));
  const head = commit(root, 'types src + delete readme');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: types/);
  assert.match(result.out, /Deleting a README/);
});

test('fails when a mapped page is deleted but left on the map', t => {
  const { root, base } = createRepo(t);
  unlinkSync(join(root, 'packages/sdk/docs/SWAPS.md'));
  const head = commit(root, 'delete mapped page');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Mapped src\(s\) are missing/);
  assert.match(result.out, /packages\/sdk\/docs\/SWAPS.md/);
});

test('fails when sdk src changes and a mapped page is deleted', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  unlinkSync(join(root, 'packages/sdk/docs/SWAPS.md'));
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify({ mirrored: MAP.mirrored.filter(item => item.src !== 'packages/sdk/docs/SWAPS.md') }, null, 2)}\n`,
  );
  const head = commit(root, 'sdk src + delete mapped page + drop map entry');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
});

test('passes when an intentionally unmirrored sdk doc is renamed', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'packages/sdk/docs/DEX.md', 'packages/sdk/docs/NEW.md']);
  const head = commit(root, 'rename unmapped dex');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('fails when a mapped sdk doc is renamed off the map', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'packages/sdk/docs/SWAPS.md', 'packages/sdk/docs/NEW.md']);
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify({ mirrored: MAP.mirrored.filter(item => item.src !== 'packages/sdk/docs/SWAPS.md') }, null, 2)}\n`,
  );
  const head = commit(root, 'rename mapped swaps + drop map entry');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /dropped off scripts\/docs-pages-map.json/);
  assert.match(result.out, /packages\/sdk\/docs\/SWAPS.md -> packages\/sdk\/docs\/NEW.md/);
});

test('fails closed when a rename cannot be checked against a base map', t => {
  const { root, base } = createRepo(t, { map: false });
  git(root, ['mv', 'packages/sdk/docs/DEX.md', 'packages/sdk/docs/NEW.md']);
  write(root, 'scripts/docs-pages-map.json', `${JSON.stringify(MAP, null, 2)}\n`);
  const head = commit(root, 'add map + rename dex');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /dropped off scripts\/docs-pages-map.json/);
});

test('fails closed when a malformed base map cannot prove a renamed page was unpublished', t => {
  const { root, base } = createRepo(t, { mapText: `${JSON.stringify(MAP, null, 2)}\n,,,` });
  git(root, ['mv', 'packages/sdk/docs/SWAPS.md', 'packages/sdk/docs/NEW.md']);
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify({ mirrored: MAP.mirrored.filter(item => item.src !== 'packages/sdk/docs/SWAPS.md') }, null, 2)}\n`,
  );
  const head = commit(root, 'repair base map + rename mapped swaps off it');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /is unreadable at/);
  assert.match(result.out, /dropped off scripts\/docs-pages-map.json/);
  assert.match(result.out, /packages\/sdk\/docs\/SWAPS.md -> packages\/sdk\/docs\/NEW.md/);
});

test('fails when the map is not valid JSON', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'scripts/docs-pages-map.json', `${JSON.stringify(MAP, null, 2)}\n,,,`);
  const head = commit(root, 'malformed map');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /is not valid JSON/);
});

test('fails when the map is not a JSON object', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'scripts/docs-pages-map.json', `${JSON.stringify(MAP.mirrored, null, 2)}\n`);
  const head = commit(root, 'map is a bare array');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /must be a JSON object/);
});

test('fails when a new sdk .mdx page is not on the map', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/docs/NEW.mdx', '# New\n');
  const head = commit(root, 'unmapped new mdx page');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /not in scripts\/docs-pages-map.json/);
  assert.match(result.out, /packages\/sdk\/docs\/NEW.mdx/);
});

test('fails when an unmapped page is moved into packages/sdk/docs', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'packages/sdk/notes/DRAFT.mdx', 'packages/sdk/docs/DRAFT.mdx']);
  const head = commit(root, 'move draft into sdk docs');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /not in scripts\/docs-pages-map.json/);
  assert.match(result.out, /packages\/sdk\/docs\/DRAFT.mdx/);
});

test('fails when a mapped sdk doc is renamed without updating the map', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'packages/sdk/docs/SWAPS.md', 'packages/sdk/docs/NEW.md']);
  const head = commit(root, 'rename mapped swaps');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Mapped src\(s\) are missing/);
  assert.match(result.out, /packages\/sdk\/docs\/SWAPS.md/);
});

test('passes when a mapped sdk doc is renamed and the map is updated', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'packages/sdk/docs/SWAPS.md', 'packages/sdk/docs/NEW.md']);
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(
      {
        mirrored: MAP.mirrored.map(item =>
          item.src === 'packages/sdk/docs/SWAPS.md'
            ? { src: 'packages/sdk/docs/NEW.md', dest: 'developers/new.md' }
            : item,
        ),
      },
      null,
      2,
    )}\n`,
  );
  const head = commit(root, 'rename mapped swaps + map');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('passes when a mapped sdk doc is renamed to .mdx and the map is updated', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'packages/sdk/docs/SWAPS.md', 'packages/sdk/docs/NEW.mdx']);
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(
      {
        mirrored: MAP.mirrored.map(item =>
          item.src === 'packages/sdk/docs/SWAPS.md'
            ? { src: 'packages/sdk/docs/NEW.mdx', dest: 'developers/new.md' }
            : item,
        ),
      },
      null,
      2,
    )}\n`,
  );
  const head = commit(root, 'rename mapped swaps to mdx + map');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs check not applicable/);
});

test('fails when the map lists a file that does not exist', t => {
  const { root, base } = createRepo(t);
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(
      {
        mirrored: [...MAP.mirrored, { src: 'packages/sdk/docs/MISSING.md', dest: 'developers/missing.md' }],
      },
      null,
      2,
    )}\n`,
  );
  const head = commit(root, 'ghost map entry');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Mapped src\(s\) are missing/);
  assert.match(result.out, /packages\/sdk\/docs\/MISSING.md/);
});

test('fails closed when a map src contains a newline', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(
      {
        mirrored: [
          {
            src: 'packages/sdk/docs/SWAPS.md\npackages/sdk/docs/FAKE.md',
            dest: 'developers/swaps.md',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  const head = commit(root, 'newline in map src');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /single-line, tab-free path/);
});

test('passes when types src changes with packages/types/docs/', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/types/src/index.ts', 'export type T = number;\n');
  write(root, 'packages/types/docs/API.md', '# types api\n');
  const head = commit(root, 'types src + package docs');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs signal/);
});

test('fails when sdk and types src change but only types has a docs signal', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'packages/types/src/index.ts', 'export type T = number;\n');
  write(root, 'packages/types/README.md', '# types\n\nUpdated.\n');
  const head = commit(root, 'sdk+types src, types readme only');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
  assert.doesNotMatch(result.out, /Source changed in:.*types/);
});

test('passes when sdk src changes with a mapped root doc listing sdk', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'docs/guide.md', '# Guide\n\nUpdated.\n');
  const head = commit(root, 'sdk + root guide');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs signal/);
});

test('fails when types src changes with a root doc that does not list types', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/types/src/index.ts', 'export type T = number;\n');
  write(root, 'docs/guide.md', '# Guide\n\nUpdated.\n');
  const head = commit(root, 'types + sdk-only root guide');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: types/);
});

test('fails when sdk src changes with a mapped root doc that has no pkgs', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(root, 'docs/meta.md', '# Meta\n\nUpdated.\n');
  const head = commit(root, 'sdk + uncovering root doc');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
});

test('fails closed when a map pkgs entry is malformed', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(
      {
        mirrored: MAP.mirrored.map(item => (item.src === 'docs/guide.md' ? { ...item, pkgs: 'sdk' } : item)),
      },
      null,
      2,
    )}\n`,
  );
  const head = commit(root, 'pkgs as string');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /pkgs must be a non-empty array/);
});

test('fails when src is renamed out of the package with no docs', t => {
  const { root, base } = createRepo(t);
  mkdirSync(join(root, 'retired'), { recursive: true });
  git(root, ['mv', 'packages/sdk/src/index.ts', 'retired/index.ts']);
  const head = commit(root, 'move sdk src out');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
});

test('fails when src is renamed into a test path with no docs', t => {
  const { root, base } = createRepo(t);
  git(root, ['mv', 'packages/sdk/src/index.ts', 'packages/sdk/src/index.test.ts']);
  const head = commit(root, 'move sdk src to a test path');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /Source changed in: sdk/);
});

test('fails closed when a map src is not a markdown page', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/sdk/src/index.ts', 'export const n = 2;\n');
  write(
    root,
    'scripts/docs-pages-map.json',
    `${JSON.stringify(
      {
        mirrored: [...MAP.mirrored, { src: 'packages/sdk/src/index.ts', dest: 'developers/index.md' }],
      },
      null,
      2,
    )}\n`,
  );
  const head = commit(root, 'map own source file as docs');

  const result = run(root, base, head);
  assert.equal(result.code, 1);
  assert.match(result.out, /must be a .md or .mdx page/);
});

test('passes when a huge changed-path list still matches the README', t => {
  const { root, base } = createRepo(t);
  write(root, 'packages/types/src/index.ts', 'export type T = number;\n');
  write(root, 'packages/types/README.md', '# types\n\nUpdated.\n');
  // >64KB of paths sorting after the README: with a producer pipeline, grep -q
  // matching early SIGPIPEs the echo under pipefail and fakes a non-match.
  for (let i = 0; i < 3000; i += 1) {
    write(root, `packages/types/src/gen/f${String(i).padStart(4, '0')}.ts`, 'export {};\n');
  }
  const head = commit(root, 'types + readme + generated files');

  const result = run(root, base, head);
  assert.equal(result.code, 0);
  assert.match(result.out, /docs signal/);
});
