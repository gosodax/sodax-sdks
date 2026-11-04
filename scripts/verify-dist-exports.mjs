import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix, resolve } from 'node:path';

// Post-build gate: assert a package emitted every file its `package.json` promises.
//
// tsup builds `dist/` with `clean: true` and emits JS in about a second but declarations ten
// seconds later, so there is a wide window where `dist/` holds runtime output and no `.d.ts`.
// Nothing downstream can tell that state apart from a finished build — turbo caches whatever
// `dist/**` contains when the task exits 0, and a consumer resolving through `exports` gets a
// "Failed to resolve entry for package" error that disappears the moment anything rebuilds.
//
// Turbo's cache is only as trustworthy as the task's exit code, so make the exit code honest:
// run this after the bundler and a half-written `dist/` fails loudly instead of being cached.
//
// Runs from the package directory (npm scripts set cwd there).

const pkgDir = process.cwd();
const pkgPath = join(pkgDir, 'package.json');

if (!existsSync(pkgPath)) {
  console.error(`verify-dist-exports: no package.json in ${pkgDir}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

/**
 * Collect every local file path a package.json points at. `exports` entries nest arbitrarily deep
 * (condition maps within subpath maps), so walk values rather than assuming a shape. Only relative
 * paths are files we build; bare specifiers are package names.
 */
function collectPaths(node, out = new Set()) {
  if (typeof node === 'string') {
    if (node.startsWith('./')) out.add(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectPaths(item, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectPaths(value, out);
  }
  return out;
}

const declared = collectPaths([pkg.exports, pkg.main, pkg.module, pkg.types, pkg.typings]);
// package.json refers to itself in most exports maps; it is not a build output.
declared.delete('./package.json');

if (declared.size === 0) {
  console.log(`verify-dist-exports: ${pkg.name} declares no built entrypoints — nothing to check`);
  process.exit(0);
}

/**
 * Expand a subpath pattern (`./dist/xchains/*​/index.mjs`) to a map of `*` substitution → file.
 * Node's `*` matches any substring including `/`, so walk everything under the static prefix and
 * match the whole relative path, capturing what `*` stood for.
 *
 * A pattern carries exactly one `*`. That is Node's own rule for the subpath key, and every target
 * this repo declares follows it — so a single substitution reconstructs a concrete path anywhere
 * below. Anything else is rejected rather than half-supported: reconstructing a multi-wildcard path
 * needs Node's "same value in every `*`" semantics, and silently getting that wrong would name the
 * wrong file in a build-failure report.
 */
function expandPattern(rel) {
  if (rel.indexOf('*') !== rel.lastIndexOf('*')) {
    console.error(`verify-dist-exports: unsupported multi-wildcard subpath pattern ${rel}`);
    process.exit(1);
  }

  const staticPrefix = rel.slice(0, rel.indexOf('*'));
  const rootRel = staticPrefix.slice(0, staticPrefix.lastIndexOf('/') + 1);
  const root = resolve(pkgDir, rootRel);
  if (!existsSync(root)) return new Map();

  const escaped = rel.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped.replaceAll('*', '(.+)')}$`);

  const found = new Map();
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else {
        const match = re.exec(`./${posix.relative(pkgDir, abs)}`);
        if (match) found.set(match[1], abs);
      }
    }
  };
  walk(root);
  return found;
}

const missing = [];
const empty = [];
const patterns = [];
let checked = 0;

for (const rel of [...declared].sort()) {
  if (rel.includes('*')) {
    patterns.push({ rel, matches: expandPattern(rel) });
    continue;
  }

  checked += 1;
  const abs = resolve(pkgDir, rel);
  if (!existsSync(abs)) {
    missing.push(rel);
    continue;
  }
  // A zero-byte artifact is a build that died mid-write, and it resolves just fine — catch it here
  // rather than letting a consumer import an empty module.
  if (statSync(abs).size === 0) empty.push(rel);
}

// Patterns sharing a prefix describe the SAME set of subpaths under different conditions, so their
// `*` substitutions must match exactly. `wallet-sdk-react` maps `./xchains/*` to both an `.mjs` and
// a `.d.ts`; a declaration pass that died halfway leaves one chain with runtime output and no
// types — importable, then broken at type-check. Requiring each pattern to have "at least one"
// match cannot see that; comparing capture sets can.
const groups = new Map();
for (const pattern of patterns) {
  const prefix = pattern.rel.slice(0, pattern.rel.indexOf('*') + 1);
  groups.set(prefix, [...(groups.get(prefix) ?? []), pattern]);
}

for (const group of groups.values()) {
  const expected = new Set(group.flatMap(pattern => [...pattern.matches.keys()]));
  if (expected.size === 0) {
    for (const { rel } of group) missing.push(rel);
    continue;
  }
  for (const { rel, matches } of group) {
    for (const substitution of [...expected].sort()) {
      checked += 1;
      const abs = matches.get(substitution);
      if (abs === undefined) missing.push(rel.replaceAll('*', substitution));
      else if (statSync(abs).size === 0) empty.push(posix.relative(pkgDir, abs));
    }
  }
}

if (missing.length > 0 || empty.length > 0) {
  console.error(`\nverify-dist-exports: ${pkg.name} build is incomplete.\n`);
  for (const rel of missing) console.error(`  missing   ${rel}`);
  for (const rel of empty) console.error(`  empty     ${rel}`);
  console.error(
    `\nThese are declared in ${basename(pkgPath)} but were not produced. The build must not be\n` +
      'cached in this state. Re-run it, and if a stale cache entry is already serving a partial\n' +
      `dist, refresh it with:\n\n  npx turbo build --force --filter=${pkg.name}\n`,
  );
  process.exit(1);
}

console.log(`verify-dist-exports: ${pkg.name} OK (${checked} declared entrypoint file(s) present)`);
