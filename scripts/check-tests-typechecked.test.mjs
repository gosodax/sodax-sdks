import assert from 'node:assert/strict';
import test from 'node:test';
import { undocumentedCastLines } from './check-tests-typechecked.mjs';

const scan = src => undocumentedCastLines(src.split('\n'));

test('flags an undocumented cast with its 1-based line number', () => {
  assert.deepEqual(scan('const a = x as unknown as Foo;'), [1]);
});

test('counts every cast on a line, not just the first', () => {
  assert.deepEqual(scan('f(x as unknown as A, y as unknown as B);'), [1, 1]);
});

test('a `//` inside a string or template literal is not documentation', () => {
  assert.deepEqual(scan("const a = x as unknown as A, u = 'https://x';"), [1]);
  assert.deepEqual(scan('const a = x as unknown as A, u = `https://x`;'), [1]);
});

test('a real trailing comment documents all casts on the line', () => {
  assert.deepEqual(scan('f(x as unknown as A, y as unknown as B); // wire shape'), []);
});

test('a comment within the two lines above documents the cast', () => {
  assert.deepEqual(scan('// wire shape\nconst a = x as unknown as A;'), []);
  assert.deepEqual(scan('/* wire shape */\n\nconst a = x as unknown as A;'), []);
  assert.deepEqual(scan('// too far\n\n\nconst a = x as unknown as A;'), [4]);
});

test('a cast inside commented-out code is ignored', () => {
  assert.deepEqual(scan('// const a = x as unknown as A;'), []);
});
