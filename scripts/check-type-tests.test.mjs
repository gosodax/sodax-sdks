import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadTypeScript } from './check-execution-mode.mjs';
import { checkTypeTests, publicCallables, referencedNames } from './check-type-tests.mjs';

const ts = loadTypeScript(fileURLToPath(new URL('../packages/sdk/', import.meta.url)));
const callables = src => publicCallables(ts, 'x.ts', src);
const check = ({ sources = {}, typeTests = {}, exemptions }) =>
  checkTypeTests({
    ts,
    sources: new Map(Object.entries(sources)),
    typeTests: new Map(Object.entries(typeTests)),
    exemptions,
  });

const SOURCE = 'export function a() {}\nexport const b = () => 1;';

test('lists exported functions, function-valued consts and public class methods', () => {
  assert.deepEqual(callables('export function a() {}\nexport const b = () => 1;\nexport const c = function () {};'), [
    'a',
    'b',
    'c',
  ]);
  assert.deepEqual(
    callables('export class S {\n  run() {}\n  static make() {}\n  handle = () => {};\n  get value() { return 1; }\n}'),
    ['S.run', 'S.make', 'S.handle'],
  );
});

test('lists functions exported through an export list or a default export', () => {
  assert.deepEqual(callables('function a() {}\nconst b = () => 1;\nexport { a, b as renamed };'), ['a', 'b']);
  assert.deepEqual(callables('function a() {}\nexport default a;'), ['a']);
});

test('lists an overloaded function once', () => {
  assert.deepEqual(callables('export function a(x: 1): 1;\nexport function a(x: 2): 2;\nexport function a(x) {}'), [
    'a',
  ]);
});

test('ignores what a caller cannot call', () => {
  assert.deepEqual(callables('function local() {}\nconst helper = () => 1;\nclass Hidden { run() {} }'), []);
  assert.deepEqual(
    callables('export class S {\n  private a() {}\n  protected b() {}\n  #c() {}\n  constructor() {}\n}'),
    [],
  );
  assert.deepEqual(callables("export const n = 1;\nexport type T = () => void;\nexport { x } from './x.js';"), []);
});

test('reads names from code and string literals, not from comments', () => {
  const names = referencedNames(
    ts,
    'x.type.test.ts',
    "// commented\nexpectTypeOf(svc.run);\nconst rows = { 'swaps.approve': 1 };",
  );
  assert.equal(names.has('run'), true);
  assert.equal(names.has('approve'), true);
  assert.equal(names.has('commented'), false);
});

test('passes when the sibling type test names every function', () => {
  const { errors, stats } = check({
    sources: { 'src/x.ts': SOURCE, 'src/types.ts': 'export type T = string;' },
    typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);\nexpectTypeOf(b);' },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(stats, { files: 1, functions: 2, exempted: 0 });
});

test('fails a source file with exported functions and no type test', () => {
  const { errors } = check({ sources: { 'src/dir/x.ts': SOURCE } });
  assert.deepEqual(errors, ['src/dir/x.ts: no x.type.test.ts beside it for: a, b']);
});

test('fails a type test that leaves a function out', () => {
  const { errors } = check({
    sources: { 'src/x.ts': SOURCE },
    typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);' },
  });
  assert.deepEqual(errors, ['src/x.type.test.ts: no assertion names: b']);
});

test('matches a public method by its own name', () => {
  const sources = { 'src/S.ts': 'export class S {\n  run() {}\n  stop() {}\n}' };
  assert.deepEqual(
    check({ sources, typeTests: { 'src/S.type.test.ts': 'expectTypeOf(svc.run);\nsvc.stop();' } }).errors,
    [],
  );
  assert.deepEqual(check({ sources, typeTests: { 'src/S.type.test.ts': 'expectTypeOf(svc.run);' } }).errors, [
    'src/S.type.test.ts: no assertion names: S.stop',
  ]);
});

test('accepts a .tsx source and a .tsx type test', () => {
  const sources = { 'src/P.tsx': 'export function P() {}' };
  assert.deepEqual(check({ sources, typeTests: { 'src/P.type.test.ts': 'expectTypeOf(P);' } }).errors, []);
  assert.deepEqual(check({ sources, typeTests: { 'src/P.type.test.tsx': 'expectTypeOf(P);' } }).errors, []);
});

test('fails a type test with no source file beside it', () => {
  const { errors } = check({
    sources: { 'src/x.ts': SOURCE },
    typeTests: { 'src/y.type.test.ts': 'expectTypeOf(a);' },
  });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^src\/y\.type\.test\.ts: no source file src\/y\.ts\(x\) beside it/);
});

test('an exemption with a reason covers a file or one function', () => {
  const whole = check({ sources: { 'src/x.ts': SOURCE }, exemptions: { 'src/x.ts': 'generated bindings' } });
  assert.deepEqual(whole.errors, []);
  assert.deepEqual(whole.stats, { files: 0, functions: 0, exempted: 2 });

  const one = check({
    sources: { 'src/x.ts': SOURCE },
    typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);' },
    exemptions: { 'src/x.ts#b': 'result is the caller-supplied type' },
  });
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.stats, { files: 1, functions: 1, exempted: 1 });
});

test('fails an exemption with no reason, and one that matches nothing', () => {
  assert.deepEqual(check({ sources: { 'src/x.ts': SOURCE }, exemptions: { 'src/x.ts': ' ' } }).errors, [
    'type-test-exemptions.json: "src/x.ts" needs a reason',
  ]);
  const stale = check({
    sources: { 'src/x.ts': SOURCE },
    typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);\nexpectTypeOf(b);' },
    exemptions: { 'src/gone.ts': 'removed file', 'src/x.ts#gone': 'removed function' },
  });
  assert.deepEqual(stale.errors, [
    'type-test-exemptions.json: "src/gone.ts" matches no exported function; drop the entry',
    'type-test-exemptions.json: "src/x.ts#gone" matches no exported function; drop the entry',
  ]);
});

test('fails a file exemption once the file has a type test', () => {
  const { errors } = check({
    sources: { 'src/x.ts': SOURCE },
    typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);' },
    exemptions: { 'src/x.ts': 'generated bindings' },
  });
  assert.deepEqual(errors, [
    'type-test-exemptions.json: "src/x.ts" is exempt but src/x.type.test.ts exists; drop the entry',
  ]);
});
