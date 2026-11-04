import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// TypeScript on a hand-written docs page is copied from a compiled region in apps/docs-examples,
// so it cannot drift from the SDK; --check fails CI on a stale copy or on unsourced TypeScript.

export const EXAMPLES_DIR = 'apps/docs-examples/src';
export const ALLOWLIST_FILE = 'scripts/docs-examples-allowlist.json';
const DOCS_DIR = 'docs';

const GATED_LANGUAGES = new Set(['ts', 'tsx', 'typescript']);
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;
const MARKER = /^\{\/\*\s*example:\s*(.*?)\s*\*\/\}$/;
const OPT_OUT = /^none(?:\s*[—:-]\s*(.*))?$/;
const REGION_START = /^\s*\/\/\s*#region\s+(\S+)\s*$/;
const REGION_END = /^\s*\/\/\s*#endregion(?:\s+(\S+))?\s*$/;

const toPosix = path => path.split(sep).join('/');

// CommonMark: a closer uses the opener's character, at least as many of them, and no info string.
const isClosingFence = (line, ticks) => {
  const closer = line.trim().match(/^(`{3,}|~{3,})$/);
  return closer !== null && closer[1][0] === ticks[0] && closer[1].length >= ticks.length;
};

/** Lines of every `// #region <name>` segment in `source`, nested markers stripped and dedented. */
export const extractRegion = (source, name) => {
  const lines = source.split(/\r?\n/);
  const segments = [];
  const open = [];
  for (const line of lines) {
    const start = line.match(REGION_START);
    if (start) {
      open.push(start[1]);
      if (start[1] === name) segments.push([]);
      continue;
    }
    const end = line.match(REGION_END);
    if (end) {
      const closed = open.pop();
      if (closed === undefined) throw new Error(`#endregion without #region`);
      if (end[1] && end[1] !== closed) throw new Error(`#endregion ${end[1]} closes #region ${closed}`);
      continue;
    }
    if (open.includes(name)) segments.at(-1).push(line);
  }
  if (open.length > 0) throw new Error(`#region ${open.at(-1)} is never closed`);
  if (segments.length === 0) throw new Error(`no #region ${name}`);

  const body = segments
    .map(segment => segment.join('\n'))
    .join('\n\n')
    .split('\n');
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body.at(-1).trim()) body.pop();
  const indent = Math.min(...body.filter(line => line.trim()).map(line => line.match(/^\s*/)[0].length));
  return body.map(line => line.slice(indent));
};

const parseMarker = line => {
  const match = line.trim().match(MARKER);
  if (!match) return null;
  const optOut = match[1].match(OPT_OUT);
  if (optOut) return { optOut: true, reason: optOut[1]?.trim() ?? '' };
  const [file, region, extra] = match[1].split('#');
  return { file, region, malformed: !file || !region || extra !== undefined };
};

/**
 * Re-fills every marked fence in `text` from its example region and counts the unmarked
 * TypeScript fences. `readExample(file)` returns the example source, or null when it is missing.
 */
export const processPage = (text, readExample) => {
  const lines = text.split('\n');
  const output = [];
  const errors = [];
  let unsourced = 0;

  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(FENCE);
    if (!fence) {
      output.push(lines[i]);
      continue;
    }
    const [, indent, ticks, language] = fence;
    let close = i + 1;
    while (close < lines.length && !isClosingFence(lines[close], ticks)) close++;
    const marker = i > 0 ? parseMarker(lines[i - 1]) : null;
    const lineNo = i + 1;

    if (close === lines.length) {
      if (marker) errors.push(`line ${lineNo}: fence is never closed`);
      else if (GATED_LANGUAGES.has(language.toLowerCase())) unsourced++;
      output.push(...lines.slice(i));
      break;
    }

    let body = lines.slice(i + 1, close);
    if (!marker) {
      if (GATED_LANGUAGES.has(language.toLowerCase())) unsourced++;
    } else if (marker.optOut) {
      if (!marker.reason)
        errors.push(`line ${lineNo}: \`example: none\` needs a reason, e.g. \`example: none — pseudocode\``);
    } else if (marker.malformed) {
      errors.push(`line ${lineNo}: marker must be \`example: <file>#<region>\``);
    } else if (posix.normalize(marker.file).startsWith('..')) {
      errors.push(`line ${lineNo}: ${marker.file} is outside ${EXAMPLES_DIR}`);
    } else {
      const source = readExample(marker.file);
      if (source === null) errors.push(`line ${lineNo}: ${EXAMPLES_DIR}/${marker.file} does not exist`);
      else {
        try {
          body = extractRegion(source, marker.region).map(line => (line ? indent + line : line));
        } catch (error) {
          errors.push(`line ${lineNo}: ${marker.file}: ${error.message}`);
        }
      }
    }

    output.push(lines[i], ...body, lines[close]);
    i = close;
  }

  return { output: output.join('\n'), unsourced, errors };
};

/**
 * Compares each page's unsourced-fence count with its allowance. Allowances only shrink: a page
 * over its allowance, or (with `base`) one the base branch did not allow as much, is a violation.
 */
export const checkAllowlist = (counts, allowlist, base) => {
  const violations = [];
  const ratcheted = {};
  for (const [page, count] of Object.entries(counts)) {
    const allowed = allowlist[page] ?? 0;
    if (count > allowed) {
      violations.push(
        `${page}: ${count} TypeScript block(s) not sourced from ${EXAMPLES_DIR}${allowed ? ` (allowed ${allowed})` : ''}`,
      );
    }
    if (Math.min(count, allowed) > 0) ratcheted[page] = Math.min(count, allowed);
  }
  const stale = Object.entries(allowlist)
    .filter(([page, allowed]) => (counts[page] ?? 0) < allowed)
    .map(([page, allowed]) => `${page}: allowance ${allowed} is above its ${counts[page] ?? 0} unsourced block(s)`);
  if (base) {
    for (const [page, allowed] of Object.entries(allowlist)) {
      if (allowed > (base[page] ?? 0))
        violations.push(`${page}: allowance raised above the base branch's ${base[page] ?? 0}`);
    }
  }
  return { violations, stale, ratcheted };
};

const listPages = root => {
  const pages = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.mdx?$/.test(entry.name)) pages.push(path);
    }
  };
  walk(join(root, DOCS_DIR));
  return pages.sort();
};

const isGenerated = text => /^generatedFrom:/m.test(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');

// Exact paths only: .mintignore holds no globs today, and an unmatched glob just means one more page is checked.
const readMintignore = root => {
  const path = join(root, DOCS_DIR, '.mintignore');
  if (!existsSync(path)) return new Set();
  const entries = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim());
  return new Set(entries.filter(line => line && !line.startsWith('#')).map(line => `${DOCS_DIR}/${line}`));
};

const readBaseAllowlist = (root, ref) => {
  try {
    const raw = execFileSync('git', ['show', `${ref}:${ALLOWLIST_FILE}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return JSON.parse(raw).pages;
  } catch {
    return null;
  }
};

export const syncDocsExamples = ({ root, check, baseRef }) => {
  const allowlistPath = join(root, ALLOWLIST_FILE);
  const allowlistJson = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const readExample = file => {
    const path = join(root, EXAMPLES_DIR, file);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  };

  const ignored = readMintignore(root);
  const counts = {};
  const errors = [];
  const drifted = [];
  for (const path of listPages(root)) {
    const page = toPosix(relative(root, path));
    if (ignored.has(page)) continue;
    const text = readFileSync(path, 'utf8');
    if (isGenerated(text)) continue;
    const result = processPage(text, readExample);
    for (const error of result.errors) errors.push(`${page} ${error}`);
    if (result.unsourced > 0) counts[page] = result.unsourced;
    if (result.output !== text) {
      drifted.push(page);
      if (!check) writeFileSync(path, result.output);
    }
  }

  const base = baseRef ? readBaseAllowlist(root, baseRef) : undefined;
  const { violations, stale, ratcheted } = checkAllowlist(counts, allowlistJson.pages, base ?? undefined);
  if (!check && stale.length > 0) {
    writeFileSync(allowlistPath, `${JSON.stringify({ ...allowlistJson, pages: ratcheted }, null, 2)}\n`);
  }
  return { errors, drifted, violations, stale: check ? stale : [], baseMissing: baseRef && base === null };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const baseIndex = args.indexOf('--base');
  const baseRef = baseIndex === -1 ? undefined : args[baseIndex + 1];
  const { errors, drifted, violations, stale, baseMissing } = syncDocsExamples({ root: process.cwd(), check, baseRef });

  if (baseMissing) console.warn(`${ALLOWLIST_FILE} is absent from ${baseRef}; skipping the base comparison.`);
  const report = (heading, items, advice) => {
    if (items.length === 0) return false;
    console.error(`${heading}\n`);
    for (const item of items) console.error(`- ${item}`);
    console.error(`\n${advice}\n`);
    return true;
  };

  const failed = [
    report(
      'Some example markers cannot be resolved:',
      errors,
      `Markers read \`{/* example: <file>#<region> */}\`, with <file> relative to ${EXAMPLES_DIR}.`,
    ),
    report(
      'Some pages show TypeScript that is not sourced from a compiled example:',
      violations,
      `Move the code into ${EXAMPLES_DIR}, wrap it in \`// #region <name>\`, and put \`{/* example: <file>#<name> */}\` on the line above the fence. Pseudocode takes \`{/* example: none — <reason> */}\`. ${ALLOWLIST_FILE} only shrinks.`,
    ),
    check &&
      report(
        'Some pages no longer match their examples:',
        drifted,
        'Run `pnpm docs:sync-examples` and commit the result.',
      ),
    report(
      'Some allowlist entries are above what their page needs:',
      stale,
      'Run `pnpm docs:sync-examples` to lower them, and commit the result.',
    ),
  ].some(Boolean);
  if (failed) process.exit(1);

  if (check) console.log('Docs examples are in sync and every TypeScript block is sourced or allowlisted.');
  else
    console.log(
      `Synced ${drifted.length} page(s)${drifted.length ? `:\n${drifted.map(page => `- ${page}`).join('\n')}` : ' (all current).'}`,
    );
}
