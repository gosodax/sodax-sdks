import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      // vitest 4 dropped `coverage.all`; an explicit include is what keeps untested files in the report.
      include: ['src/**'],
      // pancakeswap-infinity.ts is a vendored `.d.ts` copy: no runtime code, and its trailing
      // sourceMappingURL points at a map that was never vendored with it.
      exclude: ['**/*.test.ts', 'src/dex/pancakeswap-infinity.ts'],
    },
  },
});
