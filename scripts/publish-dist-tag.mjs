#!/usr/bin/env node
// Picks the npm dist-tag a release publishes under, and refuses a release that would move `latest` backwards.
//
// CLI:
//   node scripts/publish-dist-tag.mjs <package> <version> [current-latest]   prints the dist-tag
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, parseVersion } from './config-version.mjs';

/**
 * `rc` for a release candidate, `latest` for a stable release at or ahead of the package's current
 * `latest` (or its first publish). A stable release behind `latest` throws: publishing it would make
 * an older line the default install.
 */
export const distTagFor = ({ name, version, latest }) => {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`${version || '(empty)'} is not a valid version; expected X.Y.Z or X.Y.Z-rc.N`);
  if (parsed.rc !== null) return 'rc';
  if (!latest) return 'latest';
  if (!parseVersion(latest)) throw new Error(`current latest ${latest} is not a valid version`);
  if (compareVersions(parsed, latest) < 0) {
    throw new Error(
      `${name}@${version} is behind the current latest ${latest}; publishing it would move latest backwards`,
    );
  }
  return 'latest';
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [name, version, latest] = process.argv.slice(2);
  try {
    if (version === undefined) {
      throw new Error('usage: node scripts/publish-dist-tag.mjs <package> <version> [current-latest]');
    }
    console.log(distTagFor({ name, version, latest }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
