import { defineConfig } from 'tsup';

// Second build pass: declarations for the `./privy` entry alone, which take seconds. The first pass
// (tsup.config.ts) emits its JavaScript but leaves its declarations out.
export default defineConfig({
  entry: { 'privy/index': 'src/privy/index.ts' },
  outDir: 'dist',
  format: ['esm'],
  dts: { only: true },
  clean: false,
});
