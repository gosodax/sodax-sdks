#!/usr/bin/env node
// Type-test coverage guard (adr/0001-typed-and-narrowed-public-surface.md). Run from a package dir
// as the tail of its `checkTs` script (`node ../../scripts/check-type-tests.mjs`). The assertions
// themselves are checked by `tsc`; this only checks they exist. Syntactic, so it costs no typecheck.
//
// 1. Every src file that exports a function, or a class with public methods, has a sibling
//    `<file>.type.test.ts` that names each of them.
// 2. Every `*.type.test.ts` sits beside the source file it is named after.
// 3. A gap is recorded with its reason in the package's scripts/type-test-exemptions.json:
//    "src/a.ts" exempts the file, "src/a.ts#fn" or "src/a.ts#Class.method" one function. An entry
//    that no longer matches anything fails, so the list cannot outlive its reasons.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTypeScript } from './check-execution-mode.mjs';

const SOURCE = /\.tsx?$/;
const NOT_SOURCE = /\.(test|d)\.tsx?$/;
const TYPE_TEST = /\.type\.test\.tsx?$/;

// Names of the functions a source file exports: `fn` for a function or a function-valued const,
// `Class.method` for a public method (static or instance) of an exported class.
export const publicCallables = (ts, fileName, text) => {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const isExported = node => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
  const isFunction = node => node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
  const isPublic = member =>
    ts.isIdentifier(member.name) &&
    (ts.getCombinedModifierFlags(member) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;

  const declared = new Map(); // local name -> the callables exporting it contributes
  const exportedNames = new Set();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      declared.set(st.name.text, [st.name.text]);
      if (isExported(st)) exportedNames.add(st.name.text);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !isFunction(d.initializer)) continue;
        declared.set(d.name.text, [d.name.text]);
        if (isExported(st)) exportedNames.add(d.name.text);
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      const methods = st.members
        .filter(m => ts.isMethodDeclaration(m) || (ts.isPropertyDeclaration(m) && isFunction(m.initializer)))
        .filter(isPublic)
        .map(m => `${st.name.text}.${m.name.text}`);
      declared.set(st.name.text, methods);
      if (isExported(st)) exportedNames.add(st.name.text);
    } else if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause) {
      if (ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) exportedNames.add((el.propertyName ?? el.name).text);
      }
    } else if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) {
      exportedNames.add(st.expression.text);
    }
  }
  // A Set drops the repeats that overload signatures produce.
  return [...new Set([...exportedNames].flatMap(name => declared.get(name) ?? []))];
};

// Identifiers a type test mentions in code. String literals count too, split into words, because a
// table-driven test keys its rows by name ('swaps.approve'). Comments do not count.
export const referencedNames = (ts, fileName, text) => {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const names = new Set();
  const visit = node => {
    if (ts.isIdentifier(node)) names.add(node.text);
    else if (ts.isStringLiteralLike(node)) for (const word of node.text.split(/[^\w$]+/)) names.add(word);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
};

const stem = file => file.replace(SOURCE, '');
const shortName = callable => callable.slice(callable.lastIndexOf('.') + 1);

// Pure check over file contents keyed by posix path (`src/...`). `sources` holds every non-test
// source file, `typeTests` every `*.type.test.ts(x)`, `exemptions` the parsed exemptions file.
export const checkTypeTests = ({ ts, sources, typeTests, exemptions = {} }) => {
  const errors = [];
  const stats = { files: 0, functions: 0, exempted: 0 };
  const usedExemptions = new Set();
  const exempt = key => {
    if (!(key in exemptions)) return false;
    usedExemptions.add(key);
    return true;
  };
  const sourceStems = new Set([...sources.keys()].map(stem));

  for (const testFile of [...typeTests.keys()].sort()) {
    const source = testFile.replace(TYPE_TEST, '');
    if (!sourceStems.has(source)) {
      errors.push(
        `${testFile}: no source file ${source}.ts(x) beside it; a type test is named after the file it tests`,
      );
    }
  }

  for (const file of [...sources.keys()].sort()) {
    const callables = publicCallables(ts, file, sources.get(file));
    if (callables.length === 0) continue;
    const testFile = [`${stem(file)}.type.test.ts`, `${stem(file)}.type.test.tsx`].find(f => typeTests.has(f));
    if (exempt(file)) {
      if (testFile)
        errors.push(`type-test-exemptions.json: "${file}" is exempt but ${testFile} exists; drop the entry`);
      stats.exempted += callables.length;
      continue;
    }
    stats.files++;
    const required = callables.filter(name => {
      if (!exempt(`${file}#${name}`)) return true;
      stats.exempted++;
      return false;
    });
    stats.functions += required.length;
    if (!testFile) {
      errors.push(`${file}: no ${path.posix.basename(stem(file))}.type.test.ts beside it for: ${required.join(', ')}`);
      continue;
    }
    const referenced = referencedNames(ts, testFile, typeTests.get(testFile));
    const missing = required.filter(name => !referenced.has(shortName(name)));
    if (missing.length > 0) errors.push(`${testFile}: no assertion names: ${missing.join(', ')}`);
  }

  for (const [key, reason] of Object.entries(exemptions)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      errors.push(`type-test-exemptions.json: "${key}" needs a reason`);
    } else if (!usedExemptions.has(key)) {
      errors.push(`type-test-exemptions.json: "${key}" matches no exported function; drop the entry`);
    }
  }
  return { errors, stats };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const EXEMPTIONS_PATH = path.join('scripts', 'type-test-exemptions.json');
  const sources = new Map();
  const typeTests = new Map();
  for (const entry of fs.readdirSync('src', { recursive: true })) {
    const file = path.posix.join('src', entry.split(path.sep).join('/'));
    if (file.startsWith('src/e2e-tests/') || !SOURCE.test(file)) continue;
    if (TYPE_TEST.test(file)) typeTests.set(file, fs.readFileSync(file, 'utf8'));
    else if (!NOT_SOURCE.test(file)) sources.set(file, fs.readFileSync(file, 'utf8'));
  }
  const exemptions = fs.existsSync(EXEMPTIONS_PATH) ? JSON.parse(fs.readFileSync(EXEMPTIONS_PATH, 'utf8')) : {};

  const { errors, stats } = checkTypeTests({ ts: loadTypeScript(), sources, typeTests, exemptions });
  for (const error of errors) console.error(`check-type-tests: ${error}`);
  if (errors.length > 0) {
    console.error(
      `check-type-tests: ${errors.length} problem(s). Add the type test, or record the gap with its reason in ${EXEMPTIONS_PATH} (adr/0001-typed-and-narrowed-public-surface.md).`,
    );
    process.exit(1);
  }
  console.log(
    `check-type-tests: ${stats.functions} functions in ${stats.files} files are named by a type test (${stats.exempted} exempted)`,
  );
}
