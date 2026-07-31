import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/cli.tsx', 'src/ui/**'],
      reporter: ['text', 'json-summary'],
    },
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    restoreMocks: true,
  },
});
