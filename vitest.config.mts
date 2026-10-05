import { defineConfig } from 'vitest/config';

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
    ],
    coverage: {
      provider: 'v8',
      // The pure core is held to a high bar; browser-only parts are covered by the Playwright tests.
      include: [
        'src/model/**',
        'src/codec/**',
        'src/features/**',
        'src/geometry/**',
        'src/text/**',
        'src/render/export-planner.ts',
      ],
      thresholds: { lines: 95, statements: 93, functions: 95, branches: 85 },
    },
  },
});
