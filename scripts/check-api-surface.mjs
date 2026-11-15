import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
if (pkg.private || !pkg.exports) {
  console.log(`check-api-surface: ${pkg.name} OK (private or no exports; skipped)`);
  process.exit(0);
}
const ts = createRequire(path.join(cwd, 'package.json'))('typescript');
const dist = path.join(cwd, 'dist');
const failBuild = detail => {
  throw new Error(`check-api-surface: ${pkg.name}: ${detail}; run pnpm build:packages first`);
};
if (!existsSync(dist)) failBuild('dist is missing');
const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
const files = walk(dist);
const entries = [];
const exportsMap = Object.keys(pkg.exports).some(k => k.startsWith('.')) ? pkg.exports : { '.': pkg.exports };
for (const [subpath, conditions] of Object.entries(exportsMap)) {
  if (subpath === './package.json') continue;
  const target = conditions?.import?.types ?? conditions?.types;
  if (typeof target !== 'string') throw new Error(`No ESM types target for ${subpath}`);
  if (target.includes('*')) {
    const [prefix, suffix] = path.resolve(cwd, target).split('*');
    const matches = files.filter(f => f.startsWith(prefix) && f.endsWith(suffix)).sort();
    if (!matches.length) failBuild(`no declarations for ${subpath}`);
    for (const file of matches) entries.push([subpath.replaceAll('*', file.slice(prefix.length, -suffix.length)), file]);
  } else {
    const file = path.resolve(cwd, target);
    if (!existsSync(file)) failBuild(`missing ${target}`);
    entries.push([subpath, file]);
  }
}
entries.sort(([a], [b]) => a.localeCompare(b, 'en'));
const program = ts.createProgram(
  entries.map(([, f]) => f),
  {
    skipLibCheck: true,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  },
);
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const resolveAlias = symbol => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
const local = declaration => {
  const relative = path.relative(dist, declaration.getSourceFile().fileName);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const packageName = file => {
  let dir = path.dirname(file);
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8')).name;
    dir = path.dirname(dir);
  }
  throw new Error('Cannot identify external declaration package');
};
const origin = symbol => {
  for (const declaration of symbol.declarations ?? []) {
    let node = declaration;
    while (node && !ts.isSourceFile(node)) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        const specifier = node.moduleSpecifier.text;
        if (!specifier.startsWith('.')) return specifier;
      }
      node = node.parent;
    }
  }
  const declaration = resolveAlias(symbol).declarations?.[0];
  if (!declaration) throw new Error(`Unresolved export ${symbol.name}`);
  return packageName(declaration.getSourceFile().fileName);
};
const printed = new Set();
const helpers = new Map();
const external = new Set();
const declarationText = declaration => {
  // Variable declarations need their declaration list to preserve const/let and valid syntax.
  const node = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration;
  const transformed = ts.transform(node, [
    context => {
      const elide = (type, depth = 0) => {
        if (ts.isTypeLiteralNode(type) && ++depth > 2) {
          return ts.factory.createTypeReferenceNode('__elided_literal__');
        }
        return ts.visitEachChild(type, child => elide(child, depth), context);
      };
      const visit = child =>
        ts.isVariableDeclaration(child) && child.type
          ? ts.factory.updateVariableDeclaration(
              child,
              child.name,
              child.exclamationToken,
              elide(child.type),
              child.initializer,
            )
          : ts.visitEachChild(child, visit, context);
      return root => ts.visitNode(root, visit);
    },
  ]);
  const text = printer
    .printNode(ts.EmitHint.Unspecified, transformed.transformed[0], node.getSourceFile())
    .trim()
    .replace(/import\((["'])(\.[^"']+)\1\)/g, 'import("<internal>")');
  transformed.dispose();
  return text;
};
const visitReferences = declaration => {
  const visit = node => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) {
        const resolved = resolveAlias(symbol);
        const declarations = resolved.declarations ?? [];
        for (const d of declarations) {
          if (
            local(d) &&
            (ts.isTypeAliasDeclaration(d) ||
              ts.isInterfaceDeclaration(d) ||
              ts.isClassDeclaration(d) ||
              ts.isEnumDeclaration(d) ||
              ts.isModuleDeclaration(d) ||
              ts.isFunctionDeclaration(d) ||
              ts.isVariableDeclaration(d))
          ) {
            if (!printed.has(d) && !helpers.has(d)) {
              helpers.set(d, resolved.name);
              visitReferences(d);
            }
          }
        }
        if (declarations.length && declarations.every(d => !local(d)) && symbol.flags & ts.SymbolFlags.Alias) {
          external.add(
            `// external reference: ${symbol.name} = ${resolved.name.startsWith('"') ? '*' : resolved.name} from '${origin(symbol)}'`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration);
};
const lines = [
  `// ${pkg.name} public API surface — generated by scripts/check-api-surface.mjs; update with: pnpm --filter ${pkg.name} check:api-surface --update`,
  '// Variable type literals deeper than depth 2 are replaced with __elided_literal__.',
];
let count = 0;
const publicDeclarations = [];
for (const [subpath, file] of entries) {
  const source = program.getSourceFile(file);
  const module = source && checker.getSymbolAtLocation(source);
  if (!module) failBuild(`cannot read module ${subpath}`);
  lines.push('', `// entrypoint ${subpath}`);
  for (const symbol of checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    count++;
    const resolved = resolveAlias(symbol);
    const declarations = resolved.declarations ?? [];
    if (!declarations.length) throw new Error(`Unresolved export ${symbol.name}`);
    if (declarations.every(local)) {
      lines.push(`// export ${symbol.name} = ${resolved.name}`);
      for (const declaration of declarations) {
        lines.push(declarationText(declaration));
        printed.add(declaration);
        publicDeclarations.push(declaration);
      }
    } else {
      const originalName = resolved.name.startsWith('"') ? '*' : resolved.name;
      const binding = originalName === symbol.name ? symbol.name : `${originalName} as ${symbol.name}`;
      lines.push(`export { ${binding} } from '${origin(symbol)}';`);
    }
  }
}
for (const declaration of publicDeclarations) visitReferences(declaration);
lines.push('', '// internal types referenced by the public surface');
const internal = [...helpers].filter(([d]) => !printed.has(d)).map(([d, name]) => [name, declarationText(d)]);
internal.sort(([a, x], [b, y]) => a.localeCompare(b, 'en') || x.localeCompare(y, 'en'));
for (const [, text] of internal) lines.push(text);
lines.push('', '// external types referenced by the public surface', ...[...external].sort());
const report = `${lines.join('\n')}\n`;
const reportFile = path.join(cwd, 'api-surface.api.txt');
if (process.argv.includes('--update')) {
  writeFileSync(reportFile, report);
  console.log(`check-api-surface: ${pkg.name} updated (${count} exports)`);
} else {
  const previous = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : '';
  if (previous !== report) {
    const before = previous.split('\n');
    const after = report.split('\n');
    console.error(`check-api-surface: ${pkg.name} public API differs (- committed / + built)`);
    let shown = 0;
    for (let i = 0; i < Math.max(before.length, after.length) && shown < 40; i++) {
      if (before[i] === after[i]) continue;
      if (before[i] !== undefined) console.error(`- ${i + 1}: ${before[i]}`);
      if (after[i] !== undefined) console.error(`+ ${i + 1}: ${after[i]}`);
      shown += 2;
    }
    console.error(
      `Run pnpm --filter ${pkg.name} check:api-surface --update and choose the right semver bump/changeset.`,
    );
    process.exitCode = 1;
  } else console.log(`check-api-surface: ${pkg.name} OK (${count} exports across ${entries.length} entrypoint(s))`);
}
