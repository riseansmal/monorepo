import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    setupFiles: ['tooling/scripts/test-setup.mjs'],
    include: [
      'tooling/**/*.test.mjs',
      'sandbox/**/*.test.ts',
      'scopes/**/*.test.ts',
      'packages/**/*.test.ts',
    ],
    testTimeout: 30000,
  },
});
