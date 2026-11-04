import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

const isWatchMode = process.argv.includes('--watch');

// Multi-entry: barrel + per-chain sub-paths (e.g. @sodax/wallet-sdk-react/xchains/bitcoin).
// Adding a new chain? Create src/xchains/<chain>/index.ts — the listing picks it up automatically.
// Listed rather than globbed because `dts.entry` below does not expand globs.
const mainEntries = [
  'src/index.ts',
  ...readdirSync('src/xchains').flatMap(chain =>
    ['index.ts', 'index.tsx'].map(file => `src/xchains/${chain}/${file}`).filter(entry => existsSync(entry)),
  ),
];

export default defineConfig({
  // `privy` is opt-in: nothing outside `src/privy/` may value-import it (checked after build).
  entry: [...mainEntries, 'src/privy/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  // splitting shares class identity across entry points (barrel + sub-path exports),
  // so `instanceof XverseXConnector` works when imported from either location.
  splitting: true,
  clean: true,
  // Skip slow .d.ts generation during watch. `./privy` declarations come from tsup.privy-dts.config.ts:
  // emitted together with these, the declaration worker outgrows 8 GB build machines.
  dts: isWatchMode ? false : { entry: mainEntries },
  sourcemap: !process.env.CI, // On for local debug builds, off in CI (publish + ci.yml set CI=true)
  target: 'es2023',
  treeshake: true,
  external: ['react', 'react-dom', '@tanstack/react-query'],
  esbuildOptions(options) {
    options.platform = 'neutral';
    options.mainFields = ['module', 'main'];
  },
  outExtension() {
    return { js: '.mjs' };
  },
});
