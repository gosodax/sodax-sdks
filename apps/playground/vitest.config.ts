import { defineConfig } from 'vitest/config';

// Deliberately not extending vite.config.ts: its `define` block rewrites `process.version` for the
// browser bundle, and Vite's own env module then fails assigning to the resulting literal.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
