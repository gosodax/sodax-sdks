import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// A named ESM import that only a CommonJS dependency provides passes tsc and the bundler but throws at load.
const esm = await import('./dist/index.mjs');
const cjs = createRequire(import.meta.url)('./dist/index.cjs');

for (const build of [esm, cjs]) assert.equal(typeof build.XrpWalletProvider, 'function');
console.log('wallet-sdk-core ESM and CJS builds load');
