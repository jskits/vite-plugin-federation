import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results',
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
  },
  webServer: [
    {
      command: 'corepack pnpm --filter example-react-remote dev -- --host localhost --port 4174',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4174/',
    },
    {
      command: 'corepack pnpm --filter example-react-host dev -- --host localhost --port 4173',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4173/',
    },
  ],
});
