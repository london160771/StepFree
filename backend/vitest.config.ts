import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Route and API tests share one FalkorDB instance; run files one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
