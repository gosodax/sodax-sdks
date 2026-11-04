#!/usr/bin/env node
// Picks the npm dist-tag a release publishes under, so a backport never becomes the default install.
//
// CLI:
//   node scripts/publish-dist-tag.mjs <version> [current-latest]   prints the dist-tag
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseVersion } from './config-version.mjs';

/**
 * `rc` for a release candidate, `latest` for a stable release at or ahead of the package's current
 * `latest` (or its first publish), and `backport-X.Y` for a stable release behind it.
 */
export const distTagFor = ({ version, latest }) => {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`${version || '(empty)'} is not a valid version; expected X.Y.Z or X.Y.Z-rc.N`);
  if (parsed.rc !== null) return 'rc';
  if (!latest) return 'latest';
  if (!parseVersion(latest)) throw new Error(`current latest ${latest} is not a valid version`);
  return compareVersions(parsed, latest) >= 0 ? 'latest' : `backport-${parsed.major}.${parsed.minor}`;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [version, latest] = process.argv.slice(2);
  try {
    if (version === undefined) throw new Error('usage: node scripts/publish-dist-tag.mjs <version> [current-latest]');
    console.log(distTagFor({ version, latest }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
