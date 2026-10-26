import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { distTagFor } from './publish-dist-tag.mjs';

const SCRIPT = join(import.meta.dirname, 'publish-dist-tag.mjs');

test('a release candidate publishes under rc, whatever latest is', () => {
  assert.equal(distTagFor({ version: '2.3.0-rc.1', latest: '2.2.0' }), 'rc');
  assert.equal(distTagFor({ version: '2.1.1-rc.0', latest: '2.2.0' }), 'rc');
  assert.equal(distTagFor({ version: '1.0.0-rc.0', latest: '' }), 'rc');
});

test('a stable release on its first publish becomes latest', () => {
  assert.equal(distTagFor({ version: '1.0.0', latest: '' }), 'latest');
  assert.equal(distTagFor({ version: '1.0.0', latest: undefined }), 'latest');
});

test('a stable release at or ahead of latest becomes latest', () => {
  assert.equal(distTagFor({ version: '2.3.0', latest: '2.2.0' }), 'latest');
  assert.equal(distTagFor({ version: '3.0.0', latest: '2.9.9' }), 'latest');
  assert.equal(distTagFor({ version: '2.2.1', latest: '2.2.0' }), 'latest');
  // A re-run after this version already became latest must not demote it.
  assert.equal(distTagFor({ version: '2.2.0', latest: '2.2.0' }), 'latest');
});

test('a stable release behind latest is a backport and never takes latest', () => {
  assert.equal(distTagFor({ version: '2.1.1', latest: '2.2.0' }), 'backport-2.1');
  assert.equal(distTagFor({ version: '1.9.4', latest: '2.2.0' }), 'backport-1.9');
  assert.equal(distTagFor({ version: '2.2.0', latest: '2.2.1' }), 'backport-2.2');
});

test('invalid versions are refused', () => {
  assert.throws(() => distTagFor({ version: '', latest: '2.2.0' }), /not a valid version/);
  assert.throws(() => distTagFor({ version: '2.3.0-beta.1', latest: '2.2.0' }), /not a valid version/);
  assert.throws(() => distTagFor({ version: '2.3.0', latest: 'next' }), /current latest next/);
});

test('the CLI prints the dist-tag and fails without a version', () => {
  assert.equal(execFileSync('node', [SCRIPT, '2.1.1', '2.2.0'], { encoding: 'utf8' }).trim(), 'backport-2.1');
  assert.equal(execFileSync('node', [SCRIPT, '2.3.0', ''], { encoding: 'utf8' }).trim(), 'latest');
  assert.throws(() => execFileSync('node', [SCRIPT], { stdio: 'pipe' }), /usage/);
});
