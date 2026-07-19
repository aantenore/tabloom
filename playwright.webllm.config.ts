import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  expect: { timeout: 20_000 },
  fullyParallel: false,
  outputDir: 'test-results/webllm',
  reporter: process.env['CI'] ? [['github'], ['line']] : 'line',
  retries: 0,
  testDir: './tests/live',
  timeout: 900_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    reuseExistingServer: false,
    timeout: 30_000,
    url: 'http://127.0.0.1:4173',
  },
  workers: 1,
  projects: [
    {
      name: 'chrome-webgpu',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        launchOptions: {
          args: ['--enable-unsafe-webgpu'],
        },
      },
    },
  ],
});
