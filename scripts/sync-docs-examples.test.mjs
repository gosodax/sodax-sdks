import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { ALLOWLIST_FILE, checkAllowlist, extractRegion, processPage, syncDocsExamples } from './sync-docs-examples.mjs';

const createWorkspace = (t, { allowlist = {}, files = {} }) => {
  const root = mkdtempSync(join(tmpdir(), 'sync-docs-examples-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (path, content) => {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  write(ALLOWLIST_FILE, JSON.stringify({ pages: allowlist }));
  for (const [path, content] of Object.entries(files)) write(path, content);

  return { root, write, read: path => readFileSync(join(root, path), 'utf8') };
};

const EXAMPLE = `import { Sodax } from '@sodax/sdk';

export async function main() {
  // #region create
  const sodax = new Sodax();
  // #region nested
  await sodax.initialize();
  // #endregion nested
  // #endregion create
}
`;

const page = body => `---\ntitle: "Page"\nicon: book\n---\n\n${body}\n`;
const MARKED = page('{/* example: swap/create.ts#create */}\n```ts\nstale\n```');
const SYNCED = page(
  '{/* example: swap/create.ts#create */}\n```ts\nconst sodax = new Sodax();\nawait sodax.initialize();\n```',
);

test('extractRegion dedents the region and strips nested markers', () => {
  assert.deepEqual(extractRegion(EXAMPLE, 'create'), ['const sodax = new Sodax();', 'await sodax.initialize();']);
  assert.deepEqual(extractRegion(EXAMPLE, 'nested'), ['await sodax.initialize();']);
});

test('extractRegion joins repeated segments of one region', () => {
  const source = '// #region a\nimport x;\n// #endregion a\nhidden;\n// #region a\nuse(x);\n// #endregion a\n';
  assert.deepEqual(extractRegion(source, 'a'), ['import x;', '', 'use(x);']);
});

test('extractRegion rejects a missing, unclosed or mismatched region', () => {
  assert.throws(() => extractRegion(EXAMPLE, 'absent'), /no #region absent/);
  assert.throws(() => extractRegion('// #region a\nx;\n', 'a'), /never closed/);
  assert.throws(() => extractRegion('// #region a\nx;\n// #endregion b\n', 'a'), /closes #region a/);
});

test('processPage fills a marked fence and keeps list indentation', () => {
  const indented = '1. Step\n   {/* example: f.ts#r */}\n   ```ts\n   old\n   ```';
  const { output, unsourced, errors } = processPage(indented, () => '// #region r\nnew();\n// #endregion r');
  assert.equal(output, '1. Step\n   {/* example: f.ts#r */}\n   ```ts\n   new();\n   ```');
  assert.equal(unsourced, 0);
  assert.deepEqual(errors, []);
});

test('processPage counts unmarked TypeScript fences only', () => {
  const text = '```typescript\na\n```\n```tsx\nb\n```\n```bash\nc\n```\n```json\n{}\n```';
  assert.equal(processPage(text, () => null).unsourced, 2);
});

test('processPage accepts an opt-out with a reason and rejects one without', () => {
  const withReason = processPage('{/* example: none — pseudocode */}\n```ts\nsketch\n```', () => null);
  assert.deepEqual(withReason, {
    output: '{/* example: none — pseudocode */}\n```ts\nsketch\n```',
    unsourced: 0,
    errors: [],
  });

  const bare = processPage('{/* example: none */}\n```ts\nsketch\n```', () => null);
  assert.equal(bare.errors.length, 1);
  assert.match(bare.errors[0], /needs a reason/);
});

test('processPage reports a missing file, a malformed marker and a path outside the examples', () => {
  const read = () => null;
  assert.match(processPage('{/* example: gone.ts#r */}\n```ts\nx\n```', read).errors[0], /does not exist/);
  assert.match(processPage('{/* example: gone.ts */}\n```ts\nx\n```', read).errors[0], /<file>#<region>/);
  assert.match(processPage('{/* example: ../x.ts#r */}\n```ts\nx\n```', read).errors[0], /outside/);
});

test('checkAllowlist fails a page over its allowance and flags a stale one', () => {
  const { violations, stale, ratcheted } = checkAllowlist(
    { 'docs/a.md': 3, 'docs/b.md': 1 },
    { 'docs/a.md': 2, 'docs/b.md': 4, 'docs/gone.md': 1 },
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0], /docs\/a\.md: 3 .*allowed 2/);
  assert.equal(stale.length, 2);
  assert.deepEqual(ratcheted, { 'docs/a.md': 2, 'docs/b.md': 1 });
});

test('checkAllowlist fails an allowance the base branch did not grant', () => {
  const counts = { 'docs/a.md': 2, 'docs/new.md': 1 };
  const { violations } = checkAllowlist(counts, { 'docs/a.md': 2, 'docs/new.md': 1 }, { 'docs/a.md': 1 });
  assert.deepEqual(violations, [
    "docs/a.md: allowance raised above the base branch's 1",
    "docs/new.md: allowance raised above the base branch's 0",
  ]);
});

test('check mode reports a page that drifted from its example, and sync repairs it', t => {
  const { root, read } = createWorkspace(t, {
    files: { 'docs/guide.mdx': MARKED, 'apps/docs-examples/src/swap/create.ts': EXAMPLE },
  });

  assert.deepEqual(syncDocsExamples({ root, check: true }).drifted, ['docs/guide.mdx']);
  assert.equal(read('docs/guide.mdx'), MARKED);

  syncDocsExamples({ root, check: false });
  assert.equal(read('docs/guide.mdx'), SYNCED);
  assert.deepEqual(syncDocsExamples({ root, check: true }).drifted, []);
});

test('unsourced TypeScript on a new page fails; generated and mintignored pages are skipped', t => {
  const unsourced = page('```ts\nconst x = 1;\n```');
  const { root } = createWorkspace(t, {
    files: {
      'docs/new.md': unsourced,
      'docs/generated.md': '---\ntitle: "G"\ngeneratedFrom: packages/sdk/docs/G.md\n---\n\n```ts\nx\n```\n',
      'docs/AGENTS.md': '```ts\nx\n```\n',
      'docs/.mintignore': '# internal\nAGENTS.md\n',
    },
  });

  const { violations } = syncDocsExamples({ root, check: true });
  assert.deepEqual(violations, ['docs/new.md: 1 TypeScript block(s) not sourced from apps/docs-examples/src']);
});

test('sync lowers a stale allowance and never raises one', t => {
  const { root, read } = createWorkspace(t, {
    allowlist: { 'docs/a.md': 3, 'docs/b.md': 1 },
    files: { 'docs/a.md': page('```ts\nx\n```'), 'docs/b.md': page('```ts\nx\n```\n```ts\ny\n```') },
  });

  const { violations } = syncDocsExamples({ root, check: false });
  assert.deepEqual(violations, [
    'docs/b.md: 2 TypeScript block(s) not sourced from apps/docs-examples/src (allowed 1)',
  ]);
  assert.deepEqual(JSON.parse(read(ALLOWLIST_FILE)).pages, { 'docs/a.md': 1, 'docs/b.md': 1 });
});

test('--base compares the allowlist with the one on the base commit', t => {
  const { root, write } = createWorkspace(t, {
    allowlist: { 'docs/a.md': 1 },
    files: { 'docs/a.md': page('```ts\nx\n```') },
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git(
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'base',
  );

  assert.equal(syncDocsExamples({ root, check: true, baseRef: 'HEAD' }).baseMissing, true);

  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'allowlist');
  write('docs/b.md', page('```ts\ny\n```'));
  write(ALLOWLIST_FILE, JSON.stringify({ pages: { 'docs/a.md': 1, 'docs/b.md': 1 } }));

  const { violations, baseMissing } = syncDocsExamples({ root, check: true, baseRef: 'HEAD' });
  assert.equal(baseMissing, false);
  assert.deepEqual(violations, ["docs/b.md: allowance raised above the base branch's 0"]);
});
