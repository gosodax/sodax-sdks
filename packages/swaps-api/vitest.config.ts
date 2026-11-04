// @ts-nocheck
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Scaffold stage: no tests yet. Real tests land with the primitives in the
    // next stage, at which point this becomes a no-op. Keeps turbo's auto-
    // discovered `test` task from failing the package on an empty `src/`.
    passWithNoTests: true,
    coverage: {
      // vitest 4 dropped `coverage.all`; an explicit include is what keeps untested files in the report.
      include: ['src/**'],
      exclude: ['**/*.test.ts'],
    },
  },
});
