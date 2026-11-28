// @ts-nocheck
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

const TEST_ROOT = 'src';
const E2E_DIR = 'src/e2e-tests';

/** Unit test files under `src/`, as `src/…/x.test.ts` paths. */
function unitTestFiles(dir = TEST_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === E2E_DIR ? [] : unitTestFiles(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

// Module mocks (`vi.mock`/`vi.doMock`) replace modules in the registry, so those files need a fresh module graph.
// Every other file shares one per worker: importing the SDK and its chain libraries once per worker,
// not once per file, is most of the suite's wall time. Matched at statement start so a comment can't opt in.
const MOCKS_MODULES = /^\s*vi\.(?:do)?[mM]ock\(/m;
const MODULE_MOCKING = unitTestFiles().filter(file => MOCKS_MODULES.test(readFileSync(file, 'utf8')));

export default defineConfig({
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
