import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadTypeScript } from './check-execution-mode.mjs';
import { checkTypeTests, publicCallables, referencedNames } from './check-type-tests.mjs';

const ts = loadTypeScript(fileURLToPath(new URL('../packages/sdk/', import.meta.url)));

// In-memory program over one file: no lib and no module resolution, which call signatures do not need.
const callables = src => {
  const host = {
    fileExists: f => f === '/x.ts',
    readFile: () => src,
    getSourceFile: (f, target) => (f === '/x.ts' ? ts.createSourceFile(f, src, target, true) : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: f => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram(['/x.ts'], { noLib: true, noResolve: true, strict: true }, host);
  return publicCallables(ts, program.getTypeChecker(), program.getSourceFile('/x.ts'));
};
const check = ({ sources = {}, typeTests = {}, exemptions }) =>
  checkTypeTests({
    ts,
    sources: new Map(Object.entries(sources)),
    typeTests: new Map(Object.entries(typeTests)),
    exemptions,
  });

const AB = ['a', 'b'];

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

test('lists the public methods of a class expression, and a method with a quoted name', () => {
  assert.deepEqual(callables('export const S = class {\n  run() {}\n  private hidden() {}\n};'), ['S.run']);
  assert.deepEqual(callables('export class S {\n  "run"() {}\n}'), ['S.run']);
});

test('lists a const whose type is callable, however it is built', () => {
  const factory = 'const make = (code: number) => (error: unknown) => code > 0;\n';
  assert.deepEqual(callables(`${factory}export const isX = make(1);`), ['isX']);
  assert.deepEqual(callables('export const f = (() => 1) as () => number;'), ['f']);
  assert.deepEqual(callables('const impl = () => 1;\nexport const g = impl satisfies () => number;'), ['g']);
});

test('lists the function members of an exported object literal', () => {
  assert.deepEqual(callables('export const logger = { level: 1, debug() {}, info: () => {} };'), [
    'logger.debug',
    'logger.info',
  ]);
  assert.deepEqual(callables('export const o = { m() {} } as const;'), ['o.m']);
});

test('lists functions exported through an export list or a default export, by their public name', () => {
  assert.deepEqual(callables('function a() {}\nconst b = () => 1;\nexport { a, b as renamed };'), ['a', 'renamed']);
  assert.deepEqual(callables('function a() {}\nexport default a;'), ['a']);
  assert.deepEqual(callables('export default function foo() {}'), ['foo']);
  assert.deepEqual(callables('export default class K {\n  run() {}\n}'), ['K.run']);
});

test('lists an overloaded function or method once', () => {
  assert.deepEqual(
    callables('export function a(x: 1): 1;\nexport function a(x: 2): 2;\nexport function a(x: number) {}'),
    ['a'],
  );
  assert.deepEqual(callables('export class S {\n  run(x: 1): void;\n  run(x: 2): void;\n  run(x: number) {}\n}'), [
    'S.run',
  ]);
});

test('ignores what a caller cannot call', () => {
  assert.deepEqual(callables('function local() {}\nconst helper = () => 1;\nclass Hidden { run() {} }'), []);
  assert.deepEqual(
    callables('export class S {\n  private a() {}\n  protected b() {}\n  #c() {}\n  constructor() {}\n}'),
    [],
  );
  assert.deepEqual(callables('export const n = 1;\nexport const o = { n: 1 };\nexport type T = () => void;'), []);
  assert.deepEqual(callables("export { x } from './x.js';\nexport * from './y.js';"), []);
  assert.deepEqual(callables('function f() {}\nfunction g() {}\nexport type { f };\nexport { type g };'), []);
});

test('reads names from code and string literals, not from comments or imports', () => {
  const names = referencedNames(
    ts,
    'x.type.test.ts',
    "import { imported } from './x.js';\n// commented\nexpectTypeOf(svc.run);\nconst rows = { 'swaps.approve': 1 };",
  );
  assert.equal(names.has('run'), true);
  assert.equal(names.has('approve'), true);
  assert.equal(names.has('commented'), false);
  assert.equal(names.has('imported'), false);
});

test('passes when the sibling type test names every function', () => {
  const { errors, stats } = check({
    sources: { 'src/x.ts': AB, 'src/types.ts': [] },
    typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);\nexpectTypeOf(b);' },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(stats, { files: 1, functions: 2, exempted: 0 });
});

test('fails a source file with exported functions and no type test', () => {
  const { errors } = check({ sources: { 'src/dir/x.ts': AB } });
  assert.deepEqual(errors, ['src/dir/x.ts: no x.type.test.ts beside it for: a, b']);
});

test('fails a type test that leaves a function out, or only imports it', () => {
  const sources = { 'src/x.ts': AB };
  assert.deepEqual(check({ sources, typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);' } }).errors, [
    'src/x.type.test.ts: no assertion names: b',
  ]);
  const imported = "import { a, b } from './x.js';\nexpectTypeOf(a);";
  assert.deepEqual(check({ sources, typeTests: { 'src/x.type.test.ts': imported } }).errors, [
    'src/x.type.test.ts: no assertion names: b',
  ]);
});

test('matches a method or an object member by its own name', () => {
  const sources = { 'src/S.ts': ['S.run', 'S.stop'] };
  assert.deepEqual(
    check({ sources, typeTests: { 'src/S.type.test.ts': 'expectTypeOf(svc.run);\nsvc.stop();' } }).errors,
    [],
  );
  assert.deepEqual(check({ sources, typeTests: { 'src/S.type.test.ts': 'expectTypeOf(svc.run);' } }).errors, [
    'src/S.type.test.ts: no assertion names: S.stop',
  ]);
});

test('accepts a .tsx source and a .tsx type test', () => {
  const sources = { 'src/P.tsx': ['P'] };
  assert.deepEqual(check({ sources, typeTests: { 'src/P.type.test.ts': 'expectTypeOf(P);' } }).errors, []);
  assert.deepEqual(check({ sources, typeTests: { 'src/P.type.test.tsx': 'expectTypeOf(P);' } }).errors, []);
});

test('fails a type test with no source file beside it', () => {
  const { errors } = check({ sources: { 'src/x.ts': AB }, typeTests: { 'src/y.type.test.ts': 'expectTypeOf(a);' } });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^src\/y\.type\.test\.ts: no source file src\/y\.ts\(x\) beside it/);
});

test('accepts a type test beside a source file that exports no function', () => {
  const { errors } = check({
    sources: { 'src/types.ts': [] },
    typeTests: { 'src/types.type.test.ts': 'expectTypeOf<T>();' },
  });
  assert.deepEqual(errors, []);
});

test('an exemption with a reason covers a file or one function', () => {
  const whole = check({ sources: { 'src/x.ts': AB }, exemptions: { 'src/x.ts': 'generated bindings' } });
  assert.deepEqual(whole.errors, []);
  assert.deepEqual(whole.stats, { files: 0, functions: 0, exempted: 2 });

  const one = check({
    sources: { 'src/x.ts': AB },
    typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);' },
    exemptions: { 'src/x.ts#b': 'result is the caller-supplied type' },
  });
  assert.deepEqual(one.errors, []);
  assert.deepEqual(one.stats, { files: 1, functions: 1, exempted: 1 });
});

test('fails an exemption with no reason, and one that matches nothing', () => {
  assert.deepEqual(check({ sources: { 'src/x.ts': AB }, exemptions: { 'src/x.ts': ' ' } }).errors, [
    'type-test-exemptions.json: "src/x.ts" needs a reason',
  ]);
  const stale = check({
    sources: { 'src/x.ts': AB },
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
    sources: { 'src/x.ts': AB },
    typeTests: { 'src/x.type.test.ts': 'expectTypeOf(a);' },
    exemptions: { 'src/x.ts': 'generated bindings' },
  });
  assert.deepEqual(errors, [
    'type-test-exemptions.json: "src/x.ts" is exempt but src/x.type.test.ts exists; drop the entry',
  ]);
});
