// @ts-nocheck
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/e2e-tests/**'],
    coverage: {
      // vitest 4 dropped `coverage.all`; an explicit include is what keeps untested files in the report.
      include: ['src/**'],
      exclude: ['**/*.test.ts', 'src/e2e-tests/**'],
    },
  },
});
