import { defineConfig } from 'tsup';

export default defineConfig(() => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'], // Dual format: ESM for web, CJS for Node.
  outDir: 'dist',
  splitting: false, // Flat output, easier for consumers.
  sourcemap: !process.env.CI, // On for local debug builds, off in CI.
  dts: true, // Type declarations.
  clean: true,
  target: 'es2023',
  treeshake: true,
  external: [], // tsup still externalizes all dependencies by default; this is additive, not a replacement.
  // Force-bundle the ESM-only `@sodax/types` (only `getChainType` is used at runtime) so the CJS
  // build carries no `require('@sodax/types')`. Left external, a CJS consumer — or `@sodax/sdk`, which
  // externalizes this package — would `require()` an ESM-only module and hit ERR_REQUIRE_ESM on the
  // supported Node range (<20.19). `valibot` ships a `require` export, so it stays external.
  noExternal: ['@sodax/types'],
  esbuildOptions(options) {
    options.platform = 'neutral'; // Works in both node and browser.
    options.mainFields = ['module', 'main'];
    options.conditions = ['import']; // Resolve the ESM entry of bundled (noExternal) packages.
  },
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs', // Explicit extensions.
    };
  },
}));
