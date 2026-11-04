import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Post-build gate: only dist/privy/ may import @privy-io/* (an optional peer). Matches import specifiers,
// not prose — the EVM.privy doc comment names the package on purpose.

const PRIVY_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']@privy-io\//;
const distDir = join(process.cwd(), 'dist');
const privyDir = join(distDir, 'privy') + sep;

const files = readdirSync(distDir, { recursive: true, encoding: 'utf8' })
  .map(file => join(distDir, file))
  .filter(file => file.endsWith('.mjs') || file.endsWith('.d.ts'));

const leaks = files.filter(file => !file.startsWith(privyDir) && PRIVY_IMPORT.test(readFileSync(file, 'utf8')));
const entry = join(privyDir, 'index.mjs');
const entryImportsPrivy = files.includes(entry) && PRIVY_IMPORT.test(readFileSync(entry, 'utf8'));

if (leaks.length > 0 || !entryImportsPrivy) {
  for (const file of leaks)
    console.error(`check-privy-isolation: ${relative(process.cwd(), file)} imports @privy-io/*`);
  if (!entryImportsPrivy)
    console.error('check-privy-isolation: dist/privy/index.mjs does not import @privy-io/react-auth');
  process.exit(1);
}
console.log(`check-privy-isolation: OK (${files.length} files; @privy-io/* only under dist/privy/)`);
