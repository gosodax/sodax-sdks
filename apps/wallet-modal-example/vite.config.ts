import path from 'node:path';
import react from '@vitejs/plugin-react';
import type { ConfigEnv } from 'vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from '@bangjelkoski/vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite';
import svgr from 'vite-plugin-svgr';
import viteTsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig((_env: ConfigEnv) => {
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
      // Force a single React instance in the bundle. Without this, transitive
      // deps that still declare a React 18 peer (e.g. @ledgerhq/domain-service
      // pulled in via @injectivelabs/wallet-ledger) drag a second copy of
      // react/react-dom into the graph, and the dev server renders a blank
      // page because hooks fire on a different React than the renderer sees.
      dedupe: ['react', 'react-dom'],
    },

    optimizeDeps: {
      include: ['buffer'],
    },
    server: {
      open: true,
      port: 3002,
    },
    define: {
      global: 'globalThis',
      // Keep empty: loading an unfiltered environment would expose build credentials in the bundle.
      // Dependencies still need process.env defined in the browser.
      'process.env': {},
      'process.version': JSON.stringify(''),
    },
  };
});
