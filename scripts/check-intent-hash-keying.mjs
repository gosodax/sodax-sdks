#!/usr/bin/env node
/**
 * sodax-intenthash-not-unique: intentHash can recur over time. Live identity is
 * intentHash + open; chain-event identity is txHash + logIndex.
 * Suppress on the flagged line or above: sodax-allow-intenthash-key: <reason>.
 * React Query queryKey arrays are out of scope: they describe query inputs,
 * rather than asserting that a hash uniquely identifies a stored intent.
 * This is a syntax guard, not type analysis; aliases and computed keys need review.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HASH = /^(?:intentHash|intent_hash)$/;
const FILTER =
  /^(?:updateOne|updateMany|replaceOne|findOneAndUpdate|findOneAndReplace|findOneAndDelete|deleteOne|deleteMany|findOne|upsert)$/;
const KEY = /^(?:[$\w]+\.)*(?:intentHash|intent_hash)$/;

// Comments become whitespace so offsets and line numbers survive; strings stay atomic.
const tokenize = source => {
  const clean = source.replace(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*?\1|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, value =>
    value.startsWith('/') ? value.replace(/[^\n]/g, ' ') : value,
  );
  return [...clean.matchAll(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*?\1|[$\w]+|=>|\S/g)].map(m => ({
    value: m[0],
    offset: m.index,
  }));
};
const join = tokens => tokens.map(t => t.value).join('');
const parts = tokens => {
  const result = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.value === ',' && depth === 0) result.push([]);
    else result.at(-1).push(token);
    if (['(', '[', '{'].includes(token.value)) depth++;
    if ([')', ']', '}'].includes(token.value)) depth--;
  }
  return result.filter(p => p.length);
};
const contents = (tokens, start) => {
  const close = { '(': ')', '[': ']', '{': '}' }[tokens[start]?.value];
  if (!close) return [];
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].value === tokens[start].value) depth++;
    if (tokens[i].value === close && --depth === 0) return tokens.slice(start + 1, i);
  }
  return [];
};
const loneHashObject = tokens => {
  if (tokens?.[0]?.value !== '{' || tokens.at(-1)?.value !== '}') return false;
  const fields = parts(tokens.slice(1, -1));
  if (fields.length !== 1) return false;
  const field = fields[0];
  return (
    HASH.test(field[0]?.value.replace(/^['"]|['"]$/g, '')) &&
    (field.length === 1 || (field[1]?.value === ':' && field.length > 2))
  );
};
const hashSelector = tokens => {
  const text = join(tokens);
  return (
    /^['"](?:intentHash|intent_hash)['"]$/.test(text) ||
    /^(?:([$\w]+)|\(([$\w]+)\))=>\1\2\.(?:intentHash|intent_hash)$/.test(text)
  );
};

export const findIntentHashKeying = source => {
  const tokens = tokenize(source);
  const lines = source.split('\n');
  const found = [];
  const report = (token, rule) => {
    const line = source.slice(0, token.offset).split('\n').length;
    if (
      lines
        .slice(Math.max(0, line - 2), line)
        .some(l => /sodax-allow-intenthash-key:[ \t]*\S/.test(l.replace(/\*\/.*/g, '')))
    )
      return;
    found.push({ line, rule, text: lines[line - 1].trim() });
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const name = token.value;
    if (tokens[i + 1]?.value === '(') {
      const args = parts(contents(tokens, i + 1));
      if (FILTER.test(name) && loneHashObject(args[0])) report(token, 'filter');
      if (
        /^(?:createIndex|ensureIndex)$/.test(name) &&
        loneHashObject(args[0]) &&
        parts((args[1] ?? []).slice(1, -1)).some(p => /^['"]?unique['"]?:true$/.test(join(p)))
      ) {
        report(token, 'unique-index');
      }
      if (
        tokens[i - 1]?.value === '.' &&
        /^(?:set|get|has|delete)$/.test(name) &&
        KEY.test(join(args[0] ?? [])) &&
        (name === 'set' ? args.length === 2 : args.length === 1)
      ) {
        report(token, 'collection-key');
      }
      if (/^(?:uniqBy|keyBy|groupBy|dedupe)$/.test(name) && args.length === 2 && hashSelector(args[1])) {
        report(token, 'dedupe-key');
      }
      if (tokens[i - 1]?.value === 'new' && /^(?:Map|Set|WeakMap)$/.test(name)) {
        const mapped = join(args[0] ?? []);
        const selector = mapped.match(/\.map\((?:([$\w]+)|\(([$\w]+)\))=>(.*)\)$/);
        if (selector) {
          const key = `${selector[1] ?? selector[2]}.`;
          const body = selector[3];
          const firstKey = body.slice(1, body.indexOf(','));
          if (
            name === 'Set'
              ? KEY.test(body) && body.startsWith(key)
              : body.startsWith('[') && KEY.test(firstKey) && firstKey.startsWith(key)
          ) {
            report(token, 'collection-constructor');
          }
        }
      }
    }
    if (name === '[' && /^(?:[$\w]+|\])$/.test(tokens[i - 1]?.value ?? '')) {
      const key = contents(tokens, i);
      if (KEY.test(join(key)) && tokens[i + key.length + 2]?.value === '=' && tokens[i + key.length + 3]?.value !== '=')
        report(token, 'object-key');
    }
  }
  return found;
};

export const scanRepo = (root = ROOT) => {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', 'dist'].includes(entry.name)) walk(full);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full);
    }
  };
  for (const base of ['packages', 'apps']) {
    for (const entry of fs.readdirSync(path.join(root, base), { withFileTypes: true })) {
      const src = path.join(root, base, entry.name, 'src');
      if (entry.isDirectory() && fs.existsSync(src)) walk(src);
    }
  }
  return {
    filesScanned: files.length,
    violations: files.flatMap(file =>
      findIntentHashKeying(fs.readFileSync(file, 'utf8')).map(hit => ({ file: path.relative(root, file), ...hit })),
    ),
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { filesScanned, violations } = scanRepo();
  for (const { file, line, rule, text } of violations) console.error(`${file}:${line} [${rule}] ${text}`);
  console.log(
    violations.length
      ? `check-intent-hash-keying: ${violations.length} violation(s) (${filesScanned} files scanned)`
      : `check-intent-hash-keying: OK (${filesScanned} files scanned)`,
  );
  process.exitCode = violations.length ? 1 : 0;
}
