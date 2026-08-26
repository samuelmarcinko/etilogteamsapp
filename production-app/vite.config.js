import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * The Production Plan SPA.
 *
 * Builds into public/production/, which the Express server already serves via
 * its static middleware - so the Dockerfile's `COPY public ./public` picks the
 * bundle up with no deploy changes. The build output is committed, meaning the
 * VPS needs no build tooling at all.
 */
export default defineConfig({
  root: __dirname,
  base: '/production/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  },
  build: {
    outDir: path.resolve(__dirname, '../public/production'),
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    port: 5173,
    // `npm run dev:production` talks to the Express app running on 3978.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3978', changeOrigin: true }
    }
  }
});
