// @ts-nocheck
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Anchored to this file, not the cwd, so `vitest --config packages/sdk/vitest.config.ts` works from the repo root.
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const E2E_DIR = 'src/e2e-tests';

/** Unit test files under `src/`, as posix `src/…/x.test.ts` paths relative to this package (they feed globs). */
function unitTestFiles(dir = 'src'): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return path === E2E_DIR ? [] : unitTestFiles(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

// Module mocks (`vi.mock`/`vi.doMock`) replace modules in the registry, so those files need a fresh module graph.
// Every other file shares one per worker: importing the SDK and its chain libraries once per worker,
// not once per file, is most of the suite's wall time. Matched at statement start so a comment can't opt in.
const MOCKS_MODULES = /^\s*vi\.(?:do)?[mM]ock\(/m;
const MODULE_MOCKING = unitTestFiles().filter(file => MOCKS_MODULES.test(readFileSync(join(ROOT, file), 'utf8')));

export default defineConfig({
  root: ROOT,
  test: {
    pool: 'threads',
    setupFiles: ['src/test-utils/setup.ts'],
    coverage: {
      // vitest 4 dropped `coverage.all`; an explicit include is what keeps untested files in the report.
      include: ['src/**'],
      exclude: ['**/*.test.ts', 'src/e2e-tests/**', 'src/test-utils/**'],
    },
    projects: [
      { extends: true, test: { name: 'module-mocking', include: MODULE_MOCKING } },
      {
        extends: true,
        test: {
          name: 'shared-modules',
          include: ['src/**/*.test.ts'],
          exclude: ['src/e2e-tests/**', ...MODULE_MOCKING],
          isolate: false,
        },
      },
    ],
  },
});
