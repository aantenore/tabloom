import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  root: 'demo',
  resolve: {
    alias: {
      '@tabloom': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  build: {
    emptyOutDir: true,
    outDir: '../dist-demo',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./demo/index.html', import.meta.url)),
        sharedWorker: fileURLToPath(
          new URL('./demo/shared-worker.html', import.meta.url),
        ),
        webllm: fileURLToPath(new URL('./demo/webllm.html', import.meta.url)),
      },
    },
  },
  worker: { format: 'es' },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
