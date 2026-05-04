import { defineConfig } from 'vitest/config';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  define: {
    __PP_SDK_VERSION__: JSON.stringify(pkg.version)
  },
  test: {
    environment: 'jsdom',
    globals: true,
    globalSetup: ['./tests/helpers/prebuild.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/*/index.ts', 'src/common/debounce.ts', 'src/common/event-guard.ts'],
      exclude: ['src/_headers', 'src/types/**'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100
      },
      reporter: ['text', 'text-summary', 'html', 'lcov']
    },
    isolate: true,
    pool: 'forks',
    restoreMocks: true
  },
  resolve: {
    alias: {
      '@src': path.resolve(__dirname, 'src')
    }
  }
});
