import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// npm publishes package READMEs and module docs from the package, so the site gets a generated
// copy at its nav path; --check fails CI when a copy drifts from its source.

const MAP_FILE = 'scripts/docs-pages-map.json';
const DOCS_DIR = 'docs';

const stripExtension = path => path.replace(/\.mdx?$/, '');

const readMap = root => {
  const { mirrored } = JSON.parse(readFileSync(join(root, MAP_FILE), 'utf8'));
  // Entries already under docs/ are hand-authored site pages, not generated copies.
  return mirrored.filter(entry => !entry.src.startsWith(`${DOCS_DIR}/`));
};

const takeTitle = (body, entry) => {
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex(line => line.trim());
  const heading = index === -1 ? null : lines[index].match(/^#\s+(.+?)\s*$/);
  if (!heading) {
    if (entry.title) return { title: entry.title, body };
    throw new Error(`${entry.src} has no H1 — add a "title" to its ${MAP_FILE} entry.`);
  }
  // The frontmatter title renders as the page H1, so the source heading would duplicate it.
  const rest = lines.slice(index + 1);
  while (rest.length && !rest[0].trim()) rest.shift();
  return { title: entry.title ?? heading[1], body: rest.join('\n') };
};

const rewriteLinks = (body, entry, destBySource) => {
  const sourceDir = posix.dirname(entry.src);
  return body.replace(/\]\(\s*(\.\/)?([^)\s:#]+\.mdx?)((?:#[^)\s]*)?)\s*\)/g, (match, _dot, target, anchor) => {
    const resolved = posix.normalize(posix.join(sourceDir, target));
    const dest = destBySource.get(resolved);
    if (!dest) throw new Error(`${entry.src} links to ${target}, which is not a page in ${MAP_FILE}.`);
    return `](/${stripExtension(dest)}${anchor})`;
  });
};

const render = (entry, root, destBySource) => {
  const source = readFileSync(join(root, entry.src), 'utf8');
  const { title, body } = takeTitle(source, entry);
  if (!entry.icon) throw new Error(`${entry.dest} has no "icon" in ${MAP_FILE} — every page carries one.`);
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `icon: ${entry.icon}`,
    `generatedFrom: ${entry.src}`,
    '---',
    '',
    '',
  ].join('\n');
  return `${frontmatter}${rewriteLinks(body, entry, destBySource)}`;
};

// The `generatedFrom` key marks a generated page: a real key survives a dashboard publish, which
// strips frontmatter comments. The comment and body notice are legacy markers on older pages.
const isGeneratedPage = content => {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter && /^(generatedFrom:|# Generated from )/m.test(frontmatter[1])) return true;
  return /^> \*\*Generated page\.\*\* Source:/m.test(content);
};

export const syncDocsPages = ({ root, check = false } = {}) => {
  const entries = readMap(root);
  const destBySource = new Map(entries.map(entry => [entry.src, entry.dest]));
  const written = [];
  const stale = [];
  const collisions = [];

  for (const entry of entries) {
    const target = join(root, DOCS_DIR, entry.dest);
    const content = render(entry, root, destBySource);
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;

    // A typo'd dest would otherwise silently replace a hand-written page — and --check would then
    // report that page as drifted, making CI demand the overwrite.
    if (current !== null && !isGeneratedPage(current)) {
      collisions.push(
        `${DOCS_DIR}/${entry.dest} is a hand-written page, but ${MAP_FILE} maps ${entry.src} onto it. Fix that entry's "dest" — generating it would replace the page.`,
      );
      continue;
    }
    if (current === content) continue;

    if (check) {
      stale.push(
        current === null
          ? `${DOCS_DIR}/${entry.dest} is generated from ${entry.src} and has not been generated yet.`
          : `${DOCS_DIR}/${entry.dest} is generated from ${entry.src} and no longer matches it. If you edited the page, make the same edit in ${entry.src} — that file is the original, and the next sync overwrites the page from it.`,
      );
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    written.push(`${DOCS_DIR}/${entry.dest}`);
  }

  return { entries: entries.length, written, stale, collisions };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const check = process.argv.includes('--check');
  const { entries, written, stale, collisions } = syncDocsPages({ root: process.cwd(), check });

  // Reported before drift: the fix is the map, and the drift advice would say to overwrite.
  if (collisions.length > 0) {
    console.error(`Some ${MAP_FILE} entries point at pages that were never generated:\n`);
    for (const item of collisions) console.error(`- ${item}`);
    console.error('\nCorrect the "dest" on those entries, or delete the page if it is meant to be generated.');
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error('Some pages under docs/ no longer match the sources they are generated from:\n');
    for (const item of stale) console.error(`- ${item}`);
    console.error('\nRun `pnpm docs:sync-pages` and commit the result.');
    console.error(`See "Editing in the Mintlify dashboard" in ${DOCS_DIR}/README.md if you cannot run that.`);
    process.exit(1);
  }

  if (check) console.log(`Generated docs pages are up to date (${entries} pages).`);
  else
    console.log(
      `Generated ${written.length} of ${entries} docs pages${written.length ? `:\n${written.map(page => `- ${page}`).join('\n')}` : ' (all current).'}`,
    );
}
