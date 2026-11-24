import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from './dist/index.mjs';

const require = createRequire(import.meta.url);
const cjs = require('./dist/index.cjs');
const options = { cause: new Error('lost reply'), trackingId: 'original' };

assert(esm.isIndeterminateOutcomeError(new cjs.IndeterminateOutcomeError('Pending', options)));
assert(cjs.isIndeterminateOutcomeError(new esm.IndeterminateOutcomeError('Pending', options)));
assert.equal(esm.isIndeterminateOutcomeError(new Error('Unrelated')), false);
console.log('IndeterminateOutcomeError guard passed across the SDK ESM and CJS builds');
