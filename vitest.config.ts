import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // NestJS dependency injection relies on emitted decorator metadata, which
  // esbuild (vitest's default transformer) does not produce.
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      API_KEYS: 'test-key:test-owner,other-key:other-owner',
      DATA_DIR: './data/test',
      PUBLIC_BASE_URL: 'http://localhost:3000',
    },
  },
});
