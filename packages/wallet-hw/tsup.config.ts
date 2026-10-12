import { defineConfig } from 'tsup';

const isWatchMode = process.argv.includes('--watch');

export default defineConfig({
  // Multi-entry: barrel + per-device sub-paths (e.g. @sodax/wallet-hw/ledger).
  // Adding a device? Create src/<device>/index.ts and add it here.
  entry: ['src/index.ts', 'src/ledger/index.ts', 'src/trezor/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  // splitting shares module identity across entry points (barrel + sub-path exports).
  splitting: true,
  clean: true,
  dts: !isWatchMode, // skip slow .d.ts generation during watch — only needed for production builds
  sourcemap: !process.env.CI, // On for local debug builds, off in CI (publish + ci.yml set CI=true)
  target: 'es2023',
  treeshake: true,
  // Device SDKs are kept external so they are not bundled into the add-on — the
  // consumer's bundler pulls them in per imported device entry. viem/wagmi are peers.
  external: ['viem', 'wagmi', /^@ledgerhq\//, /^@trezor\//],
  esbuildOptions(options) {
    options.platform = 'neutral';
    options.mainFields = ['module', 'main'];
  },
  outExtension() {
    return { js: '.mjs' };
  },
});
