// Runs in every unit test file. Files in the shared-modules project reuse one module graph per worker, and
// vitest restores spies between files but not globals or timers, so undo those after each file.
import { afterAll, vi } from 'vitest';

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
