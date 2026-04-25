import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

export default defineConfig({
  testDir: './e2e',
  testMatch: /originjs-compat\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/compat',
  use: {
    baseURL: 'http://localhost:4193',
    headless: true,
  },
  webServer: [
    {
      command: 'corepack pnpm --filter example-react-remote preview -- --host localhost',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4174/',
    },
    {
      command: 'corepack pnpm --filter example-originjs-compat-host preview',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4193/',
    },
  ],
});
