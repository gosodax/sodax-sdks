import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { distTagFor } from './publish-dist-tag.mjs';

const SCRIPT = join(import.meta.dirname, 'publish-dist-tag.mjs');
const name = '@sodax/sdk';

test('a release candidate publishes under rc, whatever latest is', () => {
  assert.equal(distTagFor({ name, version: '2.3.0-rc.1', latest: '2.2.0' }), 'rc');
  assert.equal(distTagFor({ name, version: '2.1.1-rc.0', latest: '2.2.0' }), 'rc');
  assert.equal(distTagFor({ name, version: '1.0.0-rc.0', latest: '' }), 'rc');
});

test('a stable release on its first publish becomes latest', () => {
  assert.equal(distTagFor({ name, version: '1.0.0', latest: '' }), 'latest');
  assert.equal(distTagFor({ name, version: '1.0.0', latest: undefined }), 'latest');
});

test('a stable release at or ahead of latest becomes latest', () => {
  assert.equal(distTagFor({ name, version: '2.3.0', latest: '2.2.0' }), 'latest');
  assert.equal(distTagFor({ name, version: '3.0.0', latest: '2.9.9' }), 'latest');
  assert.equal(distTagFor({ name, version: '2.2.1', latest: '2.2.0' }), 'latest');
  // A re-run after this version already became latest must still succeed.
  assert.equal(distTagFor({ name, version: '2.2.0', latest: '2.2.0' }), 'latest');
});

test('a stable release behind latest is refused, naming the package, version and current latest', () => {
  for (const [version, latest] of [
    ['2.1.1', '2.2.0'],
    ['1.9.4', '2.2.0'],
    ['2.2.0', '2.2.1'],
  ]) {
    assert.throws(
      () => distTagFor({ name, version, latest }),
      new RegExp(
        `^Error: @sodax/sdk@${version} is behind the current latest ${latest}; publishing it would move latest backwards$`,
      ),
    );
  }
});

test('invalid versions are refused', () => {
  assert.throws(() => distTagFor({ name, version: '', latest: '2.2.0' }), /not a valid version/);
  assert.throws(() => distTagFor({ name, version: '2.3.0-beta.1', latest: '2.2.0' }), /not a valid version/);
  assert.throws(() => distTagFor({ name, version: '2.3.0', latest: 'next' }), /current latest next/);
});

test('the CLI prints the dist-tag, and exits non-zero with the reason when refusing', () => {
  assert.equal(execFileSync('node', [SCRIPT, name, '2.3.0', '2.2.0'], { encoding: 'utf8' }).trim(), 'latest');
  assert.equal(execFileSync('node', [SCRIPT, name, '2.3.0', ''], { encoding: 'utf8' }).trim(), 'latest');
  assert.throws(
    () => execFileSync('node', [SCRIPT, name, '2.1.1', '2.2.0'], { stdio: 'pipe' }),
    error => error.status === 1 && /@sodax\/sdk@2\.1\.1 is behind the current latest 2\.2\.0/.test(error.stderr),
  );
  assert.throws(() => execFileSync('node', [SCRIPT, name], { stdio: 'pipe' }), /usage/);
});
