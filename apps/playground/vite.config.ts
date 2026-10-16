import { createRequire } from 'node:module';
import path from 'node:path';
import { nodePolyfills } from '@bangjelkoski/vite-plugin-node-polyfills';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import viteTsconfigPaths from 'vite-tsconfig-paths';

const require = createRequire(import.meta.url);

export default defineConfig({
  base: '/',
  // Polyfills first: `new Sodax()` pulls bitcoinjs-lib, which needs Buffer in both dev and build.
  plugins: [nodePolyfills({ protocolImports: true }), viteTsconfigPaths(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Absolute path pins `buffer` to the npm polyfill so it is never resolved as the Node builtin.
      buffer: require.resolve('buffer/'),
    },
    // Force a single React instance: transitive deps that still declare a React 18 peer otherwise
    // drag a second copy into the graph and hooks fire on a different React than the renderer.
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['buffer'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  server: {
    port: 3005,
  },
  define: {
    global: 'globalThis',
    // Keep empty: loading an unfiltered environment would expose build credentials in the bundle.
    // Dependencies still need process.env defined in the browser.
    'process.env': {},
    'process.version': JSON.stringify(''),
  },
});
