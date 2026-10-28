// check:ai-structural 7b. Every https://github.com/gosodax/sodax-sdks/{blob,tree}/main/<path> URL under
// skills/ and in this package's top-level .md files names a file or directory in the repo. Run from
// packages/skills. Prints one BROKEN_REPO_URL line per problem and exits 0 whenever the scan itself ran;
// a non-zero exit means the scan did not run, which check-skills.sh reports as an error of its own.
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { checkRepoUrls } from '../../../scripts/check-doc-links.mjs';

const root = resolve('..', '..');
const markdownFiles = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return markdownFiles(join(dir, entry.name));
    return entry.name.endsWith('.md') ? [join(dir, entry.name)] : [];
  });
const topLevel = readdirSync('.', { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
  .map(entry => entry.name);
const files = [...topLevel, ...markdownFiles('skills')].map(file => relative(root, resolve(file)).split(sep).join('/'));

const { failures } = checkRepoUrls({ root, files });
for (const failure of failures) console.log(`BROKEN_REPO_URL: ${failure}`);
