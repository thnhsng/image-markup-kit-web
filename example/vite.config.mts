import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The example app runs on the library's sources, so edits show up without a build.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  resolve: {
    alias: { 'image-markup-kit': fileURLToPath(new URL('../src/index.ts', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true, host: true },
  preview: { port: 4173, strictPort: true, host: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
