import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    adapters: 'src/adapters.ts',
    browser: 'src/browser.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  minify: false,
  outDir: 'dist',
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: true,
});
