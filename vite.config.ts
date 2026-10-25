import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [
    dts({
      include: ['src'],
      exclude: ['src/**/*.test.ts'],
      bundleTypes: true,
      // CJS consumers under node16/nodenext resolution need a .d.cts
      afterBuild: () => {
        copyFileSync(resolve('dist/index.d.ts'), resolve('dist/index.d.cts'));
      },
    }),
  ],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'logarg',
      fileName: 'logarg',
      formats: ['es', 'cjs'],
    },
    sourcemap: true,
  },
  test: {
    // Tests live next to sources and run in both environments.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          environment: 'happy-dom',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.node.test.ts'],
        },
      },
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.mjs'],
        },
      },
    ],
  },
});
