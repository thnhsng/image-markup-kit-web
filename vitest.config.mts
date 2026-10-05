import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// BROWSERS=chromium,webkit limits the engines (e.g. where Firefox cannot start); all three by default.
const engines = (process.env.BROWSERS ?? 'chromium,webkit,firefox').split(',').filter(Boolean);

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          environment: 'node',
          include: ['test/core/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'react',
          environment: 'jsdom',
          include: ['test/react/**/*.test.{ts,tsx}'],
        },
      },
      {
        // Real engines for what only a browser can do: decoding, canvas drawing, encoding.
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: engines.map((browser) => ({ browser: browser as 'chromium' | 'webkit' | 'firefox' })),
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // The pure core is held to a high bar; browser-only parts are covered by the browser tests.
      include: [
        'src/model/**',
        'src/codec/**',
        'src/features/**',
        'src/geometry/**',
        'src/text/**',
        'src/render/export-planner.ts',
        'src/editor/**',
      ],
      thresholds: { lines: 95, statements: 93, functions: 95, branches: 85 },
    },
  },
});
