import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { MUST_NOT_BREAK_URLS, checkDocsNav } from './check-docs-nav.mjs';

const createWorkspace = (t, { navigation, files = [], mintignore, redirects } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-nav-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const write = (path, content) => {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  write('docs/docs.json', JSON.stringify({ navigation, redirects }));
  for (const file of files) write(`docs/${file}`, '');
  if (mintignore !== undefined) write('docs/.mintignore', mintignore);

  return root;
};

// The shipped frozen list names real site URLs, so tests about anything else opt out of it.
const checkNav = ({ frozenUrls = [], ...options }) => checkDocsNav({ ...options, frozenUrls });

test('passes when navigation and files agree', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index', { group: 'Swap', pages: ['swap/index'] }] }] },
    files: ['index.mdx', 'swap/index.mdx'],
  });

  const { failures, navPages, files } = checkNav({ root });

  assert.deepEqual(failures, []);
  assert.equal(navPages, 2);
  assert.equal(files, 2);
});

test('flags a nav entry with no file as a sidebar 404', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index', 'developers/ai-integration'] }] },
    files: ['index.mdx'],
  });

  const { failures } = checkNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /navigates to "developers\/ai-integration"/);
  assert.match(failures[0], /404 in the sidebar/);
});

test('flags a published page that no nav entry reaches', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'orphan.md'],
  });

  const { failures } = checkNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /docs\/orphan is published but absent/);
});

test('a root skill.md is the Mintlify agent skill, not a page needing a nav entry', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'skill.md', 'developers/skill.md'],
  });

  const { failures, files } = checkNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /docs\/developers\/skill is published but absent/);
  assert.equal(files, 2);
});

test('.mintignore exempts a file from needing a nav entry', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'local-package-testing.md', 'drafts/wip.mdx'],
    mintignore: '# repo docs\nlocal-package-testing.md\ndrafts/\n',
  });

  const { failures, files } = checkNav({ root });

  assert.deepEqual(failures, []);
  assert.equal(files, 1);
});

test('README.md and AGENTS.md are treated the way Mintlify treats them', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'README.md', 'AGENTS.md'],
    // Mintlify skips README.md by default; AGENTS.md only via .mintignore.
    mintignore: 'AGENTS.md\n',
  });

  assert.deepEqual(checkNav({ root }).failures, []);

  const withoutIgnore = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx', 'README.md', 'AGENTS.md'],
  });

  const { failures } = checkNav({ root: withoutIgnore });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /docs\/AGENTS is published/);
});

test('labels, icons and external links are not treated as page references', t => {
  const root = createWorkspace(t, {
    navigation: {
      tabs: [
        { tab: 'Home', icon: 'house', pages: ['index'] },
        { tab: 'Support', href: 'https://sodax.com/support' },
        {
          tab: 'Reference',
          groups: [{ group: 'HTTP API', icon: 'server', pages: ['api/index', 'https://example.com/spec'] }],
        },
      ],
    },
    files: ['index.mdx', 'api/index.mdx'],
  });

  assert.deepEqual(checkNav({ root }).failures, []);
});

test('reports a missing docs.json instead of throwing', t => {
  const root = mkdtempSync(join(tmpdir(), 'check-docs-nav-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const { failures } = checkNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /docs\.json is missing/);
});

test('flags a tab whose landing page an earlier tab already claims', t => {
  const root = createWorkspace(t, {
    navigation: {
      tabs: [
        { tab: 'Home', pages: ['index', { group: 'Start here', pages: ['introduction'] }] },
        { tab: 'Get Started', groups: [{ group: 'Start here', pages: ['introduction', 'solana/index'] }] },
      ],
    },
    files: ['index.mdx', 'introduction.md', 'solana/index.mdx'],
  });

  const { failures } = checkNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /tab "Get Started" lands on "introduction", which tab "Home" already lists/);
});

test('flags a tab whose landing directory an earlier tab already serves', t => {
  const root = createWorkspace(t, {
    navigation: {
      tabs: [
        // Home lists one page from how-to/, so Mintlify serves /how-to from it and the How To tab,
        // whose own pages are each listed once, is left without a landing URL.
        { tab: 'Home', pages: ['index', { group: 'Networks', pages: ['how-to/bitcoin'] }] },
        { tab: 'How To', pages: ['how-to/index', 'how-to/swap'] },
      ],
    },
    files: ['index.mdx', 'how-to/index.md', 'how-to/bitcoin.md', 'how-to/swap.md'],
  });

  const { failures } = checkNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /tab "How To" lands on "how-to\/index", but an earlier tab lists "how-to\/bitcoin"/);
});

test('a directory kept in one tab passes, and a sibling directory does not collide', t => {
  const root = createWorkspace(t, {
    navigation: {
      tabs: [
        // "contact" shares the root directory with Home's landing page, but /  still serves "index".
        { tab: 'Home', pages: ['index'] },
        { tab: 'How To', pages: ['how-to/index', 'how-to/bitcoin', 'how-to/swap'] },
        { tab: 'Help', pages: ['contact'] },
      ],
    },
    files: ['index.mdx', 'contact.mdx', 'how-to/index.md', 'how-to/bitcoin.md', 'how-to/swap.md'],
  });

  assert.deepEqual(checkNav({ root }).failures, []);
});

test('a shortcut duplicated below a tab\'s landing page is allowed', t => {
  const root = createWorkspace(t, {
    navigation: {
      tabs: [
        { tab: 'Home', pages: ['index', { group: 'Start here', pages: ['quickstart'] }] },
        { tab: 'Get Started', groups: [{ group: 'Start here', pages: ['introduction', 'quickstart'] }] },
      ],
    },
    files: ['index.mdx', 'introduction.md', 'quickstart.md'],
  });

  assert.deepEqual(checkNav({ root }).failures, []);
});

test('passes when every redirect destination and frozen URL resolves', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index', 'developers/deployments/index'] }] },
    files: ['index.mdx', 'developers/deployments/index.md'],
    redirects: [
      { source: '/developers', destination: '/developers/deployments' },
      { source: '/developers/deployments/', destination: '/developers/deployments' },
      { source: '/partners', destination: '/' },
      { source: '/support', destination: 'https://support.sodax.com' },
    ],
  });

  const frozenUrls = ['/', '/developers', '/partners', '/developers/deployments'];

  assert.deepEqual(checkNav({ root, frozenUrls }).failures, []);
});

test('flags a redirect whose destination no page serves', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx'],
    redirects: [{ source: '/partners', destination: '/contact' }],
  });

  const { failures } = checkNav({ root });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /redirects "\/partners" to "\/contact"/);
  assert.match(failures[0], /lands on a 404/);
});

test('a redirect pointing at another redirect resolves; a cycle is reported', t => {
  const chained = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx'],
    redirects: [
      { source: '/welcome-to-sodax/readme', destination: '/readme' },
      { source: '/readme', destination: '/' },
    ],
  });

  assert.deepEqual(checkNav({ root: chained }).failures, []);

  const looping = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx'],
    redirects: [
      { source: '/a', destination: '/b' },
      { source: '/b', destination: '/a' },
    ],
  });

  const { failures } = checkNav({ root: looping });

  assert.equal(failures.length, 2);
  assert.match(failures[0], /the redirects loop back to "\/b"/);
});

test('flags a must-not-break URL that neither a page nor a redirect serves', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx'],
  });

  const { failures } = checkNav({ root, frozenUrls: ['/', '/developers/faq'] });

  assert.equal(failures.length, 1);
  assert.match(failures[0], /"\/developers\/faq" is a must-not-break URL/);
  assert.match(failures[0], /no page under docs\/ serves "\/developers\/faq"/);
});

test('the shipped must-not-break list is the default, and every entry is checked', t => {
  const root = createWorkspace(t, {
    navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] },
    files: ['index.mdx'],
  });

  const { failures } = checkDocsNav({ root });

  assert.ok(MUST_NOT_BREAK_URLS.includes('/developers'));
  // "/" is the only entry this workspace serves; the rest must each be reported.
  assert.equal(failures.length, MUST_NOT_BREAK_URLS.length - 1);
});
