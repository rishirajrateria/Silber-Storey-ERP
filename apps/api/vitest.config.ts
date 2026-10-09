import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', globals: false, fileParallelism: false, testTimeout: 30000, hookTimeout: 60000, setupFiles: ['tests/setup.ts'] },
});
