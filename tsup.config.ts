import { defineConfig } from 'tsup';

// One CommonJS bundle (`main`, for Jest and TypeScript's `node` resolution) and one ES module bundle (`module`),
// with declarations for both. No sourcemaps: bundlers that read them (e.g. webpack's source-map-loader) warn
// about missing sources, and some builds treat warnings as errors.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.js' }),
  dts: true,
  target: 'es2019',
  platform: 'browser',
  splitting: false,
  sourcemap: false,
  minify: false,
  // A Rollup tree-shaking pass would drop the "use client" directive; esbuild's bundling is enough.
  treeshake: false,
  clean: true,
  external: ['react', 'react/jsx-runtime'],
  banner: { js: '"use client";' },
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.charset = 'utf8';
    options.legalComments = 'inline';
  },
});
