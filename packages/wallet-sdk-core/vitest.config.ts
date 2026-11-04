import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      // vitest 4 dropped `coverage.all`; an explicit include is what keeps untested files in the report.
      include: ['src/**'],
      // src/tests/e2e mirrors the path the `test` / `test:e2e` scripts split on.
      exclude: ['**/*.test.ts', 'src/tests/e2e/**'],
    },
  },
});
