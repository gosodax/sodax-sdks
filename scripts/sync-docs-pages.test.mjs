import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { syncDocsPages } from './sync-docs-pages.mjs';

const createWorkspace = (t, { mirrored, files = {} }) => {
  const root = mkdtempSync(join(tmpdir(), 'sync-docs-pages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (path, content) => {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  write('scripts/docs-pages-map.json', JSON.stringify({ mirrored }));
  for (const [path, content] of Object.entries(files)) write(path, content);

  return { root, read: path => readFileSync(join(root, path), 'utf8') };
};

const ENTRY = { src: 'packages/sdk/docs/SWAPS.md', dest: 'developers/swaps.md', icon: 'rotate' };

// What a previous sync left behind: the marker the generator writes, with a since-edited body.
const GENERATED_PAGE = `---
title: "Swaps"
icon: rotate
generatedFrom: packages/sdk/docs/SWAPS.md
---

Stale body.
`;

test('generates a page with frontmatter and drops the duplicated source H1', t => {
  const { root, read } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps (Solver)\n\nBody text.\n' },
  });

  const { written } = syncDocsPages({ root });

  assert.deepEqual(written, ['docs/developers/swaps.md']);
  const page = read('docs/developers/swaps.md');
  assert.match(
    page,
    /^---\ntitle: "Swaps \(Solver\)"\nicon: rotate\ngeneratedFrom: packages\/sdk\/docs\/SWAPS\.md\n---/,
  );
  assert.match(page, /\nBody text\.\n$/);
  assert.doesNotMatch(page, /# Swaps \(Solver\)/);
});

test('the marker is a real frontmatter key, with nothing shown to readers', t => {
  const { root, read } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps\n\nBody.\n' },
  });

  syncDocsPages({ root });
  const page = read('docs/developers/swaps.md');

  // A comment here would be invisible to a dashboard editor and stripped on publish.
  const frontmatter = page.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.match(frontmatter, /^generatedFrom: packages\/sdk\/docs\/SWAPS\.md$/m);
  assert.doesNotMatch(frontmatter, /^#/m);
  // The body opens on the source's own content: no sync notice reaches the published page.
  assert.doesNotMatch(page, /^> \*\*Generated page\.\*\*/m);
  assert.match(page, /^---\n[\s\S]*?\n---\n\nBody\.\n$/);
});

test('a map title overrides the source heading', t => {
  const { root, read } = createWorkspace(t, {
    mirrored: [{ ...ENTRY, title: 'Swaps' }],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps (Solver)\n\nBody.\n' },
  });

  syncDocsPages({ root });

  assert.match(read('docs/developers/swaps.md'), /title: "Swaps"/);
});

test('relative links between sources become root-relative page paths', t => {
  const { root, read } = createWorkspace(t, {
    mirrored: [ENTRY, { src: 'packages/sdk/docs/CONFIGURE_SDK.md', dest: 'developers/configure.md', icon: 'gears' }],
    files: {
      'packages/sdk/docs/SWAPS.md': '# Swaps\n\nSee [config](./CONFIGURE_SDK.md#hub) first.\n',
      'packages/sdk/docs/CONFIGURE_SDK.md': '# Configure\n\nBody.\n',
    },
  });

  syncDocsPages({ root });

  assert.match(read('docs/developers/swaps.md'), /\[config\]\(\/developers\/configure#hub\)/);
});

test('--check reports drift instead of writing', t => {
  const { root } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: {
      'packages/sdk/docs/SWAPS.md': '# Swaps\n\nNew body.\n',
      'docs/developers/swaps.md': GENERATED_PAGE,
    },
  });

  const { stale, written } = syncDocsPages({ root, check: true });

  assert.deepEqual(written, []);
  assert.equal(stale.length, 1);
  assert.match(stale[0], /docs\/developers\/swaps\.md is generated from packages\/sdk\/docs\/SWAPS\.md/);
  assert.match(stale[0], /make the same edit in packages\/sdk\/docs\/SWAPS\.md/);
});

test('--check reports a page that was never generated', t => {
  const { root } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps\n\nBody.\n' },
  });

  assert.match(syncDocsPages({ root, check: true }).stale[0], /has not been generated yet/);
});

test('a source with no H1 and no map title is an error, not an untitled page', t => {
  const { root } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: { 'packages/sdk/docs/SWAPS.md': 'Body with no heading.\n' },
  });

  assert.throws(() => syncDocsPages({ root }), /has no H1/);
});

test('a map entry without an icon is an error', t => {
  const { root } = createWorkspace(t, {
    mirrored: [{ src: ENTRY.src, dest: ENTRY.dest }],
    files: { 'packages/sdk/docs/SWAPS.md': '# Swaps\n\nBody.\n' },
  });

  assert.throws(() => syncDocsPages({ root }), /has no "icon"/);
});

test('pages already under docs/ are left alone', t => {
  const { root } = createWorkspace(t, {
    mirrored: [{ src: 'docs/ai-integration-guide.md', dest: 'developers/ai-integration.md', icon: 'robot' }],
    files: { 'docs/ai-integration-guide.md': '# Guide\n\nBody.\n' },
  });

  assert.deepEqual(syncDocsPages({ root }), { entries: 0, written: [], stale: [], collisions: [] });
});

test('refuses to overwrite a hand-written page at a mapped dest', t => {
  const handWritten = '---\ntitle: "Swaps overview"\nicon: rotate\n---\n\nWritten by a human.\n';
  const { root, read } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: {
      'packages/sdk/docs/SWAPS.md': '# Swaps\n\nBody.\n',
      'docs/developers/swaps.md': handWritten,
    },
  });

  const { written, collisions } = syncDocsPages({ root });

  assert.deepEqual(written, []);
  assert.equal(collisions.length, 1);
  assert.match(collisions[0], /docs\/developers\/swaps\.md is a hand-written page/);
  assert.match(collisions[0], /maps packages\/sdk\/docs\/SWAPS\.md onto it/);
  assert.equal(read('docs/developers/swaps.md'), handWritten);
});

test('--check calls a hand-written page at a mapped dest a collision, never drift', t => {
  const { root } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: {
      'packages/sdk/docs/SWAPS.md': '# Swaps\n\nBody.\n',
      'docs/developers/swaps.md': '---\ntitle: "Swaps overview"\n---\n\nWritten by a human.\n',
    },
  });

  const { stale, collisions } = syncDocsPages({ root, check: true });

  // Reporting this as drift is what makes CI demand the overwrite.
  assert.deepEqual(stale, []);
  assert.equal(collisions.length, 1);
});

test('a page edited in the dashboard reports drift, not a collision', t => {
  const { root } = createWorkspace(t, {
    mirrored: [ENTRY],
    files: {
      'packages/sdk/docs/SWAPS.md': '# Swaps\n\nNew body.\n',
      // A publish rewrites the body and strips frontmatter comments; the key survives.
      'docs/developers/swaps.md':
        '---\ntitle: "Swaps"\nicon: rotate\ngeneratedFrom: packages/sdk/docs/SWAPS.md\n---\n\nEdited in the dashboard.\n',
    },
  });

  const { stale, collisions } = syncDocsPages({ root, check: true });

  // A collision here would tell the author to fix the map, and stop the page regenerating at all.
  assert.deepEqual(collisions, []);
  assert.equal(stale.length, 1);
  assert.match(stale[0], /no longer matches it/);
});

test('a page carrying only the legacy comment or body notice still counts as generated', t => {
  const legacy = [
    '---\ntitle: "Swaps"\nicon: rotate\n# Generated from packages/sdk/docs/SWAPS.md by pnpm docs:sync-pages.\n---\n\nStale.\n',
    '---\ntitle: "Swaps"\nicon: rotate\n---\n\n> **Generated page.** Source: [`packages/sdk/docs/SWAPS.md`](https://github.com/icon-project/sodax-sdks/blob/main/packages/sdk/docs/SWAPS.md).\n\nStale.\n',
  ];

  for (const page of legacy) {
    const { root } = createWorkspace(t, {
      mirrored: [ENTRY],
      files: { 'packages/sdk/docs/SWAPS.md': '# Swaps\n\nNew body.\n', 'docs/developers/swaps.md': page },
    });

    const { stale, collisions } = syncDocsPages({ root, check: true });

    assert.deepEqual(collisions, []);
    assert.equal(stale.length, 1);
  }
});
