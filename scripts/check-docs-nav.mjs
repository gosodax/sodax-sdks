import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Mintlify publishes with warnings, so a nav entry without a file (a sidebar 404) and a file
// without a nav entry (published, but out of sidebar/search/llms.txt) both ship silently.

const DOCS_DIR = 'docs';
const CONFIG_FILE = 'docs.json';
const IGNORE_FILE = '.mintignore';
const PAGE_EXTENSIONS = ['.mdx', '.md'];
// Mintlify skips these without any configuration.
const DEFAULT_IGNORED_FILES = ['README.md', 'LICENSE.md', 'CHANGELOG.md'];
// Mintlify serves a root skill.md as the agent skill at /skill.md, never as a /skill page.
const ROOT_SPECIAL_FILES = ['skill.md'];
const DEFAULT_IGNORED_DIRS = [
  '.git',
  '.github',
  '.idea',
  '.vscode',
  'node_modules',
  'build',
  'dist',
  '.cache',
  'snippets',
];
// Legacy and campaign URLs with real inbound traffic, from analytics and the GitBook site they
// replaced. Renaming a page 404s them silently, so the list is frozen: extend it, never trim it.
export const MUST_NOT_BREAK_URLS = [
  '/',
  '/developers',
  '/developers/packages',
  '/developers/deployments',
  '/developers/deployments/mainnet',
  '/developers/deployments/swaps-compatible-assets',
  '/developers/deployments/solver-compatible-assets',
  '/developers/faq',
  '/solana',
  '/developers/how-to/bitcoin-integration',
  '/developers/how-to/wallet_providers',
  '/developers/how-to/monetize_sdk',
  '/developers/technical-overview/vault-token',
  '/developers/packages/foundation/sdk/functional-modules/swaps',
  '/developers/packages/foundation/sdk/functional-modules/money_market',
  '/developers/packages/foundation/sdk/functional-modules/bridge',
  '/developers/ai-integration',
  '/developers/how-to/how_to_create_a_spoke_provider',
  '/welcome-to-sodax/audits',
  '/welcome-to-sodax/readme-1',
  '/partners',
  // Served from docs/ root before this site absorbed them into /developers/how-to/.
  '/quick-sponsoring-stellar-guide',
  '/stellar-sponsoring-getting-started',
  // GitBook URLs still drawing traffic or sitting in Google's index at the docs.sodax.com cutover.
  '/solana/solana',
  '/solana/solana/quickstart',
  '/developers/how-to/oracle',
  '/sodax-mcp-server-or-cross-network-cross-chain-defi-api-data-and-sdk-docs',
  // GitBook served these from its own redirect table, which the cutover retires.
  '/developers/packages/sdk/swaps',
  '/developers/packages/sdk/money_market',
];

// Supports the .gitignore subset Mintlify documents: "!" negation, "/" anchor and directory
// suffix, "*" within a segment, "**" across segments.
const patternToRegExp = pattern => {
  const anchored = pattern.startsWith('/');
  const body = anchored ? pattern.slice(1) : pattern;
  const source = body
    .split('/')
    .map(segment => {
      if (segment === '**') return '.*';
      return segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
    })
    .join('/');
  // An unanchored pattern matches at any depth, the way .gitignore treats "AGENTS.md".
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${source}(?:/.*)?$`);
};

const parseIgnoreFile = content =>
  content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const negated = line.startsWith('!');
      const pattern = (negated ? line.slice(1) : line).replace(/\/$/, '');
      return { negated, matches: patternToRegExp(pattern) };
    });

const isIgnored = (relPath, rules) => {
  let ignored = false;
  for (const rule of rules) {
    if (rule.matches.test(relPath)) ignored = !rule.negated;
  }
  return ignored;
};

// A tab whose landing page an earlier tab also lists renders under that earlier tab, so its
// navbar link goes nowhere. Shortcut duplicates deeper in a sidebar are fine.
const findDeadTabs = navigation => {
  const claimedBy = new Map();
  const dead = [];
  for (const tab of navigation.tabs ?? []) {
    const pages = collectNavPages(tab);
    const [landing] = pages;
    if (landing && claimedBy.has(landing)) {
      dead.push({ tab: tab.tab, landing, owner: claimedBy.get(landing) });
    }
    for (const page of pages) if (!claimedBy.has(page)) claimedBy.set(page, tab.tab);
  }
  return dead;
};

// Mintlify serves a directory URL from the first page listed under it, whichever tab that page sits
// in — an index page does not win by being an index page. So a tab landing on "<dir>/index" loses
// its navbar link to any sibling an earlier tab lists: the tab either opens that sibling under the
// earlier tab, or renders with no link at all. findDeadTabs misses this because the landing page
// itself is listed once. Fix by keeping every page under a directory in the same tab.
const findHijackedTabs = navigation => {
  const tabs = navigation.tabs ?? [];
  const order = tabs.flatMap(tab => collectNavPages(tab));
  const servedBy = directory => {
    const prefix = directory ? `${directory}/` : '';
    return order.find(page => page.startsWith(prefix) && !page.slice(prefix.length).includes('/'));
  };

  const hijacked = [];
  for (const tab of tabs) {
    const [landing] = collectNavPages(tab);
    if (!landing) continue;
    const directory = landing === 'index' ? '' : landing.endsWith('/index') ? landing.slice(0, -6) : null;
    if (directory === null) continue;
    const served = servedBy(directory);
    if (served && served !== landing) hijacked.push({ tab: tab.tab, landing, directory, served });
  }
  return hijacked;
};

// Page references only live in "pages" arrays; other strings are labels, icons and tab names.
const collectNavPages = node => {
  const pages = [];
  const walk = (value, inPages) => {
    if (typeof value === 'string') {
      if (inPages) pages.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, inPages);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, key === 'pages');
    }
  };
  walk(node, false);
  return pages;
};

const listPageFiles = (dir, rules, base = dir) => {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const relPath = relative(base, absolute).split(sep).join(posix.sep);
    if (statSync(absolute).isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.includes(entry)) continue;
      if (isIgnored(relPath, rules)) continue;
      found.push(...listPageFiles(absolute, rules, base));
      continue;
    }
    const extension = PAGE_EXTENSIONS.find(candidate => entry.endsWith(candidate));
    if (!extension) continue;
    if (DEFAULT_IGNORED_FILES.includes(entry)) continue;
    if (ROOT_SPECIAL_FILES.includes(relPath)) continue;
    if (isIgnored(relPath, rules)) continue;
    found.push(relPath.slice(0, -extension.length));
  }
  return found;
};

const normalizeUrl = url => {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  return path === '' ? '/' : path;
};

// Mintlify serves /<path> from docs/<path>.mdx|.md, and a directory path from its index page.
const servesPage = (url, pageSet) => {
  const path = url.replace(/^\/+/, '');
  return pageSet.has(path) || pageSet.has(path ? `${path}/index` : 'index');
};

// An off-site destination, or one carrying a wildcard or :param, has no single page to resolve.
const isResolvable = target => target.startsWith('/') && !/[*:]/.test(target);

// Follows the redirect chain the way a browser does; returns why it dead-ends, or null.
const resolveUrl = (url, pageSet, redirects) => {
  const seen = new Set();
  let current = normalizeUrl(url);
  while (!servesPage(current, pageSet)) {
    if (seen.has(current)) return `the redirects loop back to "${current}"`;
    seen.add(current);
    const next = redirects.get(current);
    if (next === undefined) return `no page under ${DOCS_DIR}/ serves "${current}"`;
    if (!isResolvable(next)) return null;
    current = normalizeUrl(next);
  }
  return null;
};

export const checkDocsNav = ({ root, docsDir = DOCS_DIR, frozenUrls = MUST_NOT_BREAK_URLS } = {}) => {
  const docsPath = join(root, docsDir);
  const configPath = join(docsPath, CONFIG_FILE);
  if (!existsSync(configPath)) {
    return {
      failures: [`${docsDir}/${CONFIG_FILE} is missing — cannot verify navigation.`],
      navPages: 0,
      files: 0,
      redirects: 0,
    };
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const ignorePath = join(docsPath, IGNORE_FILE);
  const rules = existsSync(ignorePath) ? parseIgnoreFile(readFileSync(ignorePath, 'utf8')) : [];

  const navPages = [
    ...new Set(collectNavPages(config.navigation ?? {}).filter(page => !/^[a-z][a-z0-9+.-]*:/i.test(page))),
  ];
  const files = listPageFiles(docsPath, rules);
  const fileSet = new Set(files);
  const navSet = new Set(navPages);

  const failures = [];
  for (const page of navPages.filter(page => !fileSet.has(page)).sort()) {
    failures.push(
      `${docsDir}/${CONFIG_FILE} navigates to "${page}" but no ${docsDir}/${page}.mdx|.md exists — that is a 404 in the sidebar.`,
    );
  }
  for (const { tab, landing, owner } of findDeadTabs(config.navigation ?? {})) {
    failures.push(
      `${CONFIG_FILE} tab "${tab}" lands on "${landing}", which tab "${owner}" already lists — the page renders under "${owner}", so the "${tab}" navbar link goes nowhere. Give "${tab}" a landing page no earlier tab lists.`,
    );
  }
  for (const { tab, landing, directory, served } of findHijackedTabs(config.navigation ?? {})) {
    failures.push(
      `${CONFIG_FILE} tab "${tab}" lands on "${landing}", but an earlier tab lists "${served}", so Mintlify serves "/${directory}" from that page instead — the "${tab}" navbar link opens it under the earlier tab. Move every page directly under "${directory}/" into one tab.`,
    );
  }
  for (const file of files.filter(file => !navSet.has(file)).sort()) {
    failures.push(
      `${docsDir}/${file} is published but absent from ${CONFIG_FILE} navigation — add a nav entry, or add the file to ${docsDir}/${IGNORE_FILE} if it should not be on the site.`,
    );
  }

  const redirectEntries = (config.redirects ?? []).filter(
    entry => typeof entry?.source === 'string' && typeof entry?.destination === 'string',
  );
  const redirects = new Map(redirectEntries.map(entry => [normalizeUrl(entry.source), entry.destination]));

  for (const { source, destination } of redirectEntries) {
    if (!isResolvable(destination)) continue;
    const reason = resolveUrl(destination, fileSet, redirects);
    if (reason) {
      failures.push(
        `${CONFIG_FILE} redirects "${source}" to "${destination}", but ${reason} — the redirect lands on a 404.`,
      );
    }
  }
  for (const url of frozenUrls) {
    const reason = resolveUrl(url, fileSet, redirects);
    if (reason) {
      failures.push(
        `"${url}" is a must-not-break URL but ${reason} — restore the page, or add a ${CONFIG_FILE} redirect sending it somewhere that still exists.`,
      );
    }
  }

  return { failures, navPages: navPages.length, files: files.length, redirects: redirectEntries.length };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { failures, navPages, files, redirects } = checkDocsNav({ root: process.cwd() });

  if (failures.length > 0) {
    console.error('Docs navigation check failed:\n');
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(`\nSee ${DOCS_DIR}/README.md for how pages, URLs and navigation relate.`);
    process.exit(1);
  }

  console.log(
    `Docs navigation check passed (${navPages} nav entries, ${files} published pages, ${redirects} redirects, ${MUST_NOT_BREAK_URLS.length} must-not-break URLs).`,
  );
}
