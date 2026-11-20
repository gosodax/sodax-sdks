#!/usr/bin/env node
// Execution-mode guards for dual-mode actions (`walletProvider` signs and broadcasts, `raw: true`
// builds the unsigned tx). Run from a package dir as the tail of its `checkTs` script
// (`node ../../scripts/check-execution-mode.mjs`). Scans src/**/*.ts(x), test files excluded:
//
// 1. No `raw === false` (or `!==`, `==`, `!=`). A signed call may omit `raw`, so `undefined` has to
//    take the signed branch: test the mode with `!x.raw` or `x.raw === true`.
// 2. A public class method's `extends boolean` type param defaults to `false`. Without it, a call that
//    omits `raw` resolves to the hash-or-raw-tx union instead of the hash.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TypeScript is a devDependency of each package, not of the repo root, so resolve it from `dir`.
export const loadTypeScript = (dir = process.cwd()) => createRequire(path.join(dir, 'package.json'))('typescript');

// Violations in one source file, each as { line, message } with a 1-based line.
export const findViolations = (ts, fileName, text) => {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const lineOf = node => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const equality = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
  ]);
  const unwrap = n => (ts.isParenthesizedExpression(n) ? unwrap(n.expression) : n);
  const isRaw = n =>
    (ts.isIdentifier(n) && n.text === 'raw') ||
    (ts.isPropertyAccessExpression(n) && n.name.text === 'raw') ||
    (ts.isElementAccessExpression(n) &&
      ts.isStringLiteral(n.argumentExpression) &&
      n.argumentExpression.text === 'raw');
  const isFalse = n => n.kind === ts.SyntaxKind.FalseKeyword;
  const isFalseType = n => n !== undefined && ts.isLiteralTypeNode(n) && n.literal.kind === ts.SyntaxKind.FalseKeyword;
  const isPublic = node =>
    !ts.isPrivateIdentifier(node.name) &&
    (ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;

  const found = [];
  const visit = node => {
    if (ts.isBinaryExpression(node) && equality.has(node.operatorToken.kind)) {
      const [left, right] = [unwrap(node.left), unwrap(node.right)];
      if ((isRaw(left) && isFalse(right)) || (isFalse(left) && isRaw(right))) {
        found.push({
          line: lineOf(node),
          message: `\`${node.getText(sf)}\` sends a call that omits \`raw\` down the raw branch; use \`!x.raw\` or \`x.raw === true\``,
        });
      }
    }
    if (ts.isMethodDeclaration(node) && ts.isClassLike(node.parent) && node.typeParameters && isPublic(node)) {
      for (const tp of node.typeParameters) {
        if (tp.constraint?.kind === ts.SyntaxKind.BooleanKeyword && !isFalseType(tp.default)) {
          found.push({
            line: lineOf(node),
            message: `${node.name.getText(sf)}: \`${tp.name.text} extends boolean\` needs \`= false\`, or a call that omits \`raw\` gets the hash-or-raw-tx union`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const ts = loadTypeScript();
  const files = fs
    .readdirSync('src', { recursive: true })
    .filter(f => /\.tsx?$/.test(f) && !/\.(test|d)\.tsx?$/.test(f))
    .map(f => path.join('src', f));

  let count = 0;
  for (const file of files) {
    for (const v of findViolations(ts, file, fs.readFileSync(file, 'utf8'))) {
      console.error(`check-execution-mode: ${file}:${v.line}: ${v.message}`);
      count++;
    }
  }
  if (count > 0) process.exit(1);
  console.log(`check-execution-mode: ${files.length} source files ok`);
}
