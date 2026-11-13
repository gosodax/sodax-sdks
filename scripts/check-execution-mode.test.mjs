import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { findViolations, loadTypeScript } from './check-execution-mode.mjs';

const ts = loadTypeScript(fileURLToPath(new URL('../packages/sdk/', import.meta.url)));
const lines = src => findViolations(ts, 'x.ts', src).map(v => v.line);

test('flags raw compared to false, either side, any equality operator', () => {
  assert.deepEqual(lines('if (params.raw === false) {}'), [1]);
  assert.deepEqual(lines('if (_params?.raw !== false) {}'), [1]);
  assert.deepEqual(lines('const { raw } = p;\nif (false == raw) {}'), [2]);
  assert.deepEqual(lines("if ((p.raw) === false) {}\nif (p['raw'] === false) {}"), [1, 2]);
});

test('accepts the mode checks that treat an omitted raw as signed', () => {
  assert.deepEqual(lines('if (!params.raw) {}\nif (params.raw === true) {}\nif (params.raw) {}'), []);
});

test('ignores raw === false in comments and strings', () => {
  assert.deepEqual(lines("// raw === false\nconst s = 'raw === false';"), []);
});

test('flags a public method whose boolean type param has no default, whatever its name', () => {
  assert.deepEqual(lines('class S {\n  async approve<K, Raw extends boolean>(p: P<K, Raw>) {}\n}'), [2]);
  assert.deepEqual(lines('class S {\n  public static make<R extends boolean>(p: P<R>) {}\n}'), [2]);
  assert.deepEqual(lines('class S {\n  async run<TRaw extends boolean>(p: P<TRaw>) {}\n}'), [2]);
  assert.deepEqual(lines('class S {\n  async approve<Raw extends boolean = boolean>(p: P<Raw>) {}\n}'), [2]);
});

test('accepts a defaulted Raw, private helpers, and type-level generics', () => {
  assert.deepEqual(lines('class S {\n  async approve<K, Raw extends boolean = false>(p: P<K, Raw>) {}\n}'), []);
  assert.deepEqual(
    lines('class S {\n  private plan<Raw extends boolean>(p: P<Raw>) {}\n  #run<R extends boolean>() {}\n}'),
    [],
  );
  assert.deepEqual(lines('type A<K, Raw extends boolean> = P<K, Raw>;\nfunction g<Raw extends boolean>() {}'), []);
  assert.deepEqual(lines('const helpers = {\n  build<R extends boolean>(p: P<R>) {},\n};'), []);
});
