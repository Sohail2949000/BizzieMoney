import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@bizziemoney/database': resolve(
        process.cwd(),
        'packages/database/src/index.ts',
      ),
      '@bizziemoney/shared': resolve(
        process.cwd(),
        process.env.VITEST_SHARED_DIST === 'true'
          ? 'packages/shared/dist/index.js'
          : 'packages/shared/src/index.ts',
      ),
      '@bizziemoney/storage': resolve(
        process.cwd(),
        'packages/storage/src/index.ts',
      ),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    include: ['apps/**/*.test.{ts,tsx}', 'packages/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    restoreMocks: true,
    setupFiles: ['./apps/web/src/test/setup.ts'],
  },
});
