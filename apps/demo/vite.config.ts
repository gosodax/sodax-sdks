import path from 'node:path';
import react from '@vitejs/plugin-react';
import type { ConfigEnv } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import { nodePolyfills } from '@bangjelkoski/vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';
import svgr from 'vite-plugin-svgr';
import viteTsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(({ command, mode }: ConfigEnv) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    // depending on your application, base can also be "/"
    base: '/',
    plugins: [
      tailwindcss(),
      svgr({
        include: '**/*.svg',
        svgrOptions: {
          ref: true,
        },
      }),
      viteTsconfigPaths(),
      react({
        babel: {
          plugins: ['macros'],
        },
      }),
      nodePolyfills({ protocolImports: true }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        buffer: 'buffer/',
      },
    },

    optimizeDeps: {
      include: ['buffer'],
    },
    server: {
      // this ensures that the browser opens upon server start
      open: true,
      // this sets a default port to 3000
      port: 3000,
      // Local observability testing (no DNS): forward `/__intake/*` to the localhost mock-intake
      // server (`pnpm mock-intake`). The browser only ever talks to this same-origin path, so the
      // Sentry/Datadog adapters need no DNS resolution and trigger no CORS preflight.
      proxy: {
        '/__intake': {
          target: env.MOCK_INTAKE_URL || 'http://localhost:9009',
          changeOrigin: true,
          rewrite: p => p.replace(/^\/__intake/, ''),
        },
      },
    },
    define: {
      global: 'globalThis',
      'process.env': env,
      'process.version': JSON.stringify(''),
    },
  };
});
