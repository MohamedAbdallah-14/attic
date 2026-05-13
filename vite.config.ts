import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import manifest from './src/manifest';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [tailwindcss(), crx({ manifest })],
  define: {
    // Exposes the package.json version to the popup footer so users can see
    // which build they're running. Stringify because Vite's define injects
    // the literal value as source.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5174 },
  },
  build: {
    target: 'es2022',
    sourcemap: 'inline',
  },
});
