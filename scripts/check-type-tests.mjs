#!/usr/bin/env node
// Type-test coverage guard (adr/0001-typed-and-narrowed-public-surface.md). Run from a package dir
// as the tail of its `checkTs` script (`node ../../scripts/check-type-tests.mjs`). The assertions
// themselves are checked by `tsc`; this only checks they exist. It asks the type checker which
// exports are callable, so a guard built by a factory call counts like a function declaration.
//
// 1. Every src file that exports something callable has a sibling `<file>.type.test.ts` that names
//    each of them: functions, function-typed consts, the function members of an exported object
//    literal, and the public methods of an exported class.
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

// Names of the callables a source file exports: `fn` for a function or a function-typed const,
// `obj.fn` for a function member of an exported object literal, `Class.method` for a public method
// (static or instance) of an exported class. Re-exports belong to the file that declares them.
export const publicCallables = (ts, checker, sf) => {
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return [];
  const isCallable = (symbol, at) => checker.getTypeOfSymbolAtLocation(symbol, at).getCallSignatures().length > 0;
  const isPublic = member =>
    member.name !== undefined &&
    (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
    (ts.getCombinedModifierFlags(member) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;
  const unwrap = node =>
    node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))
      ? unwrap(node.expression)
      : node;
  const isTypeOnly = exported =>
    exported.declarations?.some(d => ts.isExportSpecifier(d) && (d.isTypeOnly || d.parent.parent.isTypeOnly));
  const classOf = decl => {
    if (ts.isClassDeclaration(decl)) return decl;
    const initializer = ts.isVariableDeclaration(decl) ? unwrap(decl.initializer) : undefined;
    return initializer && ts.isClassExpression(initializer) ? initializer : undefined;
  };

  const names = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const decl = symbol.valueDeclaration;
    if (!decl || decl.getSourceFile() !== sf || isTypeOnly(exported)) continue;
    // A default export is asserted under the name it was declared with.
    const name = exported.getName() === 'default' ? (decl.name?.text ?? 'default') : exported.getName();
    const cls = classOf(decl);
    if (cls) {
      for (const member of cls.members) {
        if (!isPublic(member)) continue;
        const callable =
          ts.isMethodDeclaration(member) || (ts.isPropertyDeclaration(member) && isCallable(member.symbol, member));
        if (callable) names.push(`${name}.${member.name.text}`);
      }
    } else if (isCallable(symbol, decl)) {
      names.push(name);
    } else if (ts.isVariableDeclaration(decl) && ts.isObjectLiteralExpression(unwrap(decl.initializer) ?? decl)) {
      const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
      for (const member of type.getProperties())
        if (isCallable(member, decl)) names.push(`${name}.${member.getName()}`);
    }
  }
  // A Set drops the repeats that overloaded methods produce.
  return [...new Set(names)];
};

// Identifiers a type test mentions in code. String literals count too, split into words, because a
// table-driven test keys its rows by name ('swaps.approve'). Comments and imports do not count.
export const referencedNames = (ts, fileName, text) => {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const names = new Set();
  const visit = node => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node)) names.add(node.text);
    else if (ts.isStringLiteralLike(node)) for (const word of node.text.split(/[^\w$]+/)) names.add(word);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
};

const stem = file => file.replace(SOURCE, '');
const shortName = callable => callable.slice(callable.lastIndexOf('.') + 1);

// Pure check keyed by posix path (`src/...`). `sources` maps every non-test source file to its
// exported callables, `typeTests` every `*.type.test.ts(x)` to its text, `exemptions` is the parsed
// exemptions file.
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
    const callables = sources.get(file);
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
  const ts = loadTypeScript();
  const config = ts.getParsedCommandLineOfConfigFile(
    'tsconfig.json',
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: d => {
        console.error(`check-type-tests: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
        process.exit(1);
      },
    },
  );
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();

  const sources = new Map();
  const typeTests = new Map();
  const notInProgram = [];
  for (const entry of fs.readdirSync('src', { recursive: true })) {
    const file = path.posix.join('src', entry.split(path.sep).join('/'));
    if (file.startsWith('src/e2e-tests/') || !SOURCE.test(file)) continue;
    if (TYPE_TEST.test(file)) typeTests.set(file, fs.readFileSync(file, 'utf8'));
    else if (!NOT_SOURCE.test(file)) {
      const sf = program.getSourceFile(path.resolve(file));
      if (sf) sources.set(file, publicCallables(ts, checker, sf));
      else notInProgram.push(file);
    }
  }
  const exemptions = fs.existsSync(EXEMPTIONS_PATH) ? JSON.parse(fs.readFileSync(EXEMPTIONS_PATH, 'utf8')) : {};

  const { errors, stats } = checkTypeTests({ ts, sources, typeTests, exemptions });
  for (const file of notInProgram)
    errors.push(`${file}: not in the tsc program (tsconfig.json), so its exports cannot be read`);
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
