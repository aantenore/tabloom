import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    adapters: 'src/adapters.ts',
    browser: 'src/browser.ts',
    core: 'src/core.ts',
    index: 'src/index.ts',
    'shared-worker': 'src/shared-worker.ts',
    webllm: 'src/adapters/webllm.ts',
  },
  format: ['esm'],
  minify: false,
  outDir: 'dist',
  sourcemap: true,
  splitting: true,
  target: 'es2022',
  treeshake: true,
});
