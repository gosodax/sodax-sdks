#!/usr/bin/env node
// Test-typing guards, shared across packages — run from a package dir as the tail of its
// `checkTs` script (`node ../../scripts/check-tests-typechecked.mjs [--project tsconfig.x.json]`).
// Two checks:
//
// 1. Every src/**/*.test.ts(x) file must be part of the tsc program of the given --project
//    (default tsconfig.json). Without this, re-adding a test exclude would silently shrink
//    coverage while checkTs stays green. `tsc --showConfig` only resolves the file list, ~1s.
//
// 2. Every `as unknown as` cast in a test file needs a one-line why-comment on the same line or
//    within the two lines above (a biome-ignore justification counts) — such a cast is the
//    strongest escape hatch the tests allow, so each one must say why it is deliberate.
//    Pre-existing undocumented casts are grandfathered per file in the package's
//    scripts/test-cast-comment-baseline.json (absent file = empty baseline) and may only ratchet
//    down; `--update-baseline` regenerates it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Cast scanning (exported for check-tests-typechecked.test.mjs) ──────────────
const CAST = ' as unknown as ';
const isComment = l => {
  const t = l.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
};
// First real `//` on the line; `//` inside '…', "…" or `…` is string content, not a comment.
// Line-local by design — a template literal spanning lines can still fool it.
const commentStart = line => {
  let quote = null;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (quote) {
      if (c === '\\') j += 1;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '/' && line[j + 1] === '/') return j;
  }
  return -1;
};
// 1-based line numbers of undocumented casts, one entry per cast so a line holding several
// casts ratchets the baseline by its real count. A cast after `//` is commented-out code.
export const undocumentedCastLines = lines => {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const comment = commentStart(lines[i]);
    const code = comment === -1 ? lines[i] : lines[i].slice(0, comment);
    let at = code.indexOf(CAST);
    if (at === -1) continue;
    if (comment !== -1 || lines.slice(Math.max(0, i - 2), i).some(isComment)) continue;
    for (; at !== -1; at = code.indexOf(CAST, at + 1)) found.push(i + 1);
  }
  return found;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const update = args.includes('--update-baseline');
  const projIdx = args.indexOf('--project');
  const project = projIdx !== -1 ? args[projIdx + 1] : 'tsconfig.json';
  const BASELINE_PATH = path.join('scripts', 'test-cast-comment-baseline.json');

  const testFiles = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) testFiles.push(p);
    }
  };
  walk('src');

  let failed = false;

  // ── Check 1: all test files are in the tsc program ───────────────────────────
  if (!update) {
    const out = spawnSync('tsc', ['-p', project, '--showConfig'], { encoding: 'utf8' });
    if (out.status !== 0) {
      console.error(out.stderr || out.stdout);
      process.exit(out.status ?? 1);
    }
    let files;
    try {
      files = JSON.parse(out.stdout).files ?? [];
    } catch (e) {
      console.error(`check-tests-typechecked: malformed tsc --showConfig output (${e.message})`);
      process.exit(1);
    }
    const inProgram = new Set(files.map(f => path.normalize(f.replace(/^\.\//, ''))));
    const missing = testFiles.filter(f => !inProgram.has(path.normalize(f)));
    if (missing.length > 0) {
      failed = true;
      console.error(
        `check-tests-typechecked: ${missing.length} test file(s) are excluded from the tsc program (${project}), so checkTs no longer typechecks them:`,
      );
      for (const f of missing) console.error(`  - ${f}`);
      console.error('Remove the tsconfig exclude (or include change) that hides them.');
    } else {
      console.log(`check-tests-typechecked: all ${testFiles.length} test files are in the tsc program`);
    }
  }

  // ── Check 2: `as unknown as` casts carry a why-comment (baseline-ratcheted) ──
  const undocumented = new Map(); // file -> 1-based lines, one entry per cast
  for (const file of testFiles) {
    const lines = undocumentedCastLines(fs.readFileSync(file, 'utf8').split('\n'));
    if (lines.length > 0) undocumented.set(file, lines);
  }

  if (update) {
    const baseline = Object.fromEntries([...undocumented.entries()].sort().map(([f, ls]) => [f, ls.length]));
    fs.mkdirSync('scripts', { recursive: true });
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`check-tests-typechecked: cast-comment baseline updated (${undocumented.size} files)`);
    process.exit(0);
  }

  const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) : {};
  let shrinkable = 0;
  for (const [file, lines] of [...undocumented.entries()].sort()) {
    const allowed = baseline[file] ?? 0;
    if (lines.length > allowed) {
      failed = true;
      console.error(
        `check-tests-typechecked: ${file} has ${lines.length} undocumented 'as unknown as' cast(s), baseline allows ${allowed} (lines: ${lines.join(', ')})`,
      );
      console.error(
        '  Add a one-line why-comment on or just above each new cast, or document an existing cast in the same file.',
      );
    } else if (lines.length < allowed) shrinkable++;
  }
  for (const file of Object.keys(baseline)) {
    if (!undocumented.has(file) && baseline[file] > 0) shrinkable++;
  }
  if (failed) process.exit(1);
  if (shrinkable > 0) {
    console.log(
      'check-tests-typechecked: cast comments ok — baseline can shrink; run: node ../../scripts/check-tests-typechecked.mjs --update-baseline',
    );
  } else {
    console.log('check-tests-typechecked: cast comments ok');
  }
}
