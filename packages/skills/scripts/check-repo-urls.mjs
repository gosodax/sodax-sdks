// check:ai-structural 7b: prints one BROKEN_REPO_URL line per problem.
// A non-zero exit means the scan itself did not run; check-skills.sh reports that as an error.
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepoUrls } from '../../../scripts/check-doc-links.mjs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const root = join(pkg, '..', '..');
const markdownFiles = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) return markdownFiles(join(dir, entry.name));
    return entry.name.endsWith('.md') ? [join(dir, entry.name)] : [];
  });
const topLevel = readdirSync(pkg, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
  .map(entry => join(pkg, entry.name));
const files = [...topLevel, ...markdownFiles(join(pkg, 'skills'))].map(file =>
  relative(root, file).split(sep).join('/'),
);

const { failures } = checkRepoUrls({ root, files });
for (const failure of failures) console.log(`BROKEN_REPO_URL: ${failure}`);
