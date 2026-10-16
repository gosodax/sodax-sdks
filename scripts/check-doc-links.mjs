import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The manifest holds two kinds of source, with opposite link rules.
// A package doc is moved and renamed on its way to a page, so a relative link is only safe when
// the target lands in the same destination directory under the same filename; everything else
// needs an absolute sodax-sdks URL, which also resolves for the npm and GitHub readers.
// A source already under docs/ IS the page: its internal links must be root-relative and
// extensionless, because relative and extension-bearing targets 404 in production.
// See scripts/docs-pages-map.json for the manifest and docs/AGENTS.md for the site rules.

const BLOB_BASE = 'https://github.com/icon-project/sodax-sdks/blob/main/';
const TREE_BASE = 'https://github.com/icon-project/sodax-sdks/tree/main/';
const PAGE_EXTENSIONS = ['.md', '.mdx'];
const SOURCE_URL = /^https:\/\/github\.com\/icon-project\/sodax-sdks\/(?:blob|tree)\/main\/([^?#]+)/;
const WRONG_REPO_URLS = [
  { pattern: 'github.com/icon-project/sodax-document/', hint: 'link to the sodax-sdks source file instead' },
  { pattern: 'github.com/icon-project/sodax-frontend/', hint: 'the repo was renamed to sodax-sdks' },
];

const stripCode = content => {
  let fenced = false;
  return content.split(/\r?\n/).map(line => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    if (fenced) return '';
    // Blank balanced inline-code spans so documented markdown examples aren't treated as links.
    return line.replace(/`[^`]*`/g, match => ' '.repeat(match.length));
  });
};

const collectTargets = line => {
  const targets = [];
  for (const match of line.matchAll(/\]\(\s*([^)\s]+)/g)) targets.push(match[1]);
  for (const match of line.matchAll(/href=["']([^"']+)["']/g)) targets.push(match[1]);
  for (const match of line.matchAll(/<(https?:\/\/[^>\s]+)>/g)) targets.push(match[1]);
  return targets;
};

const splitAnchor = target => {
  const hashIndex = target.indexOf('#');
  return hashIndex === -1 ? [target, ''] : [target.slice(0, hashIndex), target.slice(hashIndex)];
};

const decode = path => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const checkAbsolute = ({ target, inRepo }) => {
  const [url] = splitAnchor(target);

  const wrongRepo = WRONG_REPO_URLS.find(entry => url.includes(entry.pattern));
  if (wrongRepo) return `links into ${wrongRepo.pattern} — ${wrongRepo.hint}: ${url}`;

  const sourceUrl = url.match(SOURCE_URL);
  if (!sourceUrl) return null;

  const path = decode(sourceUrl[1]).replace(/\/$/, '');
  return inRepo(path) ? null : `links to ${path}, which does not exist in this repo: ${url}`;
};

// Resolves a root-relative site target to what Mintlify serves: a page file, a directory index,
// or a static asset committed under docs/.
const servesUnderDocs = ({ path, inRepo, isDir }) => {
  const base = posix.join('docs', path.replace(/^\/+/, '').replace(/\/+$/, ''));
  if (PAGE_EXTENSIONS.some(ext => inRepo(`${base}${ext}`) || inRepo(posix.join(base, `index${ext}`)))) return true;
  return inRepo(base) && !isDir(base);
};

const checkSitePage = ({ target, inRepo, isDir }) => {
  const [path, anchor] = splitAnchor(target);
  if (!path) return null;

  if (!path.startsWith('/'))
    return `relative link ${target} 404s in production; site pages link root-relative, e.g. /developers/faq`;

  const extension = PAGE_EXTENSIONS.find(ext => path.endsWith(ext));
  if (extension) return `link ${target} keeps its ${extension} extension, which 404s in production; drop it`;

  if (!servesUnderDocs({ path, inRepo, isDir }))
    return `links to ${path}${anchor}, which no page or asset under docs/ serves`;

  return null;
};

const checkRelative = ({ target, srcDir, destDir, destBySrc, inRepo, isDir }) => {
  if (target.startsWith('/')) return `uses a root-relative link ${target}; use an absolute ${BLOB_BASE}… URL`;

  const [path, anchor] = splitAnchor(target);
  if (!path) return null;

  const resolvedSrc = posix.normalize(posix.join(srcDir, path));
  if (!inRepo(resolvedSrc)) return `links to missing ${resolvedSrc} (link target ${target})`;

  const mirroredDest = destBySrc.get(resolvedSrc);
  if (mirroredDest && mirroredDest === posix.normalize(posix.join(destDir, path))) return null;

  const base = isDir(resolvedSrc) ? TREE_BASE : BLOB_BASE;
  const reason = mirroredDest ? `its page moves to ${mirroredDest}` : 'it is not published as a page';
  return `relative link ${target} breaks on docs.sodax.com — ${reason}. Use ${base}${resolvedSrc}${anchor}`;
};

export const checkDocLinks = ({ root, manifestPath = 'scripts/docs-pages-map.json' } = {}) => {
  const failures = [];
  const absolute = path => join(root, path);
  const inRepo = path => existsSync(absolute(path));
  const isDir = path => inRepo(path) && statSync(absolute(path)).isDirectory();

  if (!inRepo(manifestPath)) {
    return { failures: [`Missing docs page manifest ${manifestPath}`], checked: 0, links: 0 };
  }

  const { mirrored } = JSON.parse(readFileSync(absolute(manifestPath), 'utf8'));
  const destBySrc = new Map(mirrored.map(entry => [entry.src, entry.dest]));
  let links = 0;

  for (const { src, dest } of mirrored) {
    if (!inRepo(src)) {
      failures.push(`${manifestPath} maps missing file ${src} (update the manifest when a doc moves or is renamed)`);
      continue;
    }

    const isSiteSource = src === 'docs' || src.startsWith('docs/');
    const context = { srcDir: posix.dirname(src), destDir: posix.dirname(dest), destBySrc, inRepo, isDir };
    const checkInternal = isSiteSource ? checkSitePage : checkRelative;

    stripCode(readFileSync(absolute(src), 'utf8')).forEach((line, index) => {
      for (const target of collectTargets(line)) {
        if (target.startsWith('#') || /^(mailto|tel):/i.test(target)) continue;
        links += 1;

        const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
        const problem = isAbsolute ? checkAbsolute({ target, inRepo }) : checkInternal({ ...context, target });

        if (problem) failures.push(`${src}:${index + 1} ${problem}`);
      }
    });
  }

  return { failures, checked: mirrored.length, links };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { failures, checked, links } = checkDocLinks({ root: process.cwd() });

  if (failures.length > 0) {
    console.error('Doc link validation failed:\n');
    for (const failure of failures) console.error(`- ${failure}`);
    console.error('\nRules: in a package doc a link may stay relative only when the target lands in the');
    console.error(`same directory under the same name; otherwise use ${BLOB_BASE}<path>.`);
    console.error('In a docs/ page, internal links are root-relative and extensionless (/developers/faq).');
    process.exit(1);
  }

  console.log(`Doc link validation passed (${checked} published files, ${links} links).`);
}
