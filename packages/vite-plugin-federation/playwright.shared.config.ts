import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

export default defineConfig({
  testDir: './e2e',
  testMatch: /shared-(?:negotiation|fallback|workspace)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/shared',
  use: {
    headless: true,
  },
  webServer: [
    {
      command: 'corepack pnpm --filter example-shared-strict-fallback-app preview',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4190/',
    },
    {
      command: 'corepack pnpm --filter example-shared-host-only-remote preview',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4191/',
    },
    {
      command: 'corepack pnpm --filter example-shared-host-only-host preview',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4192/',
    },
    {
      command: 'corepack pnpm --filter example-shared-negotiation-remote preview:loaded-first',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4184/',
    },
    {
      command: 'corepack pnpm --filter example-shared-negotiation-host preview:loaded-first',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4183/',
    },
    {
      command: 'corepack pnpm --filter example-shared-negotiation-remote preview:version-first',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4186/',
    },
    {
      command: 'corepack pnpm --filter example-shared-negotiation-host preview:version-first',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4185/',
    },
    {
      command: 'corepack pnpm --filter example-workspace-shared-remote preview',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4200/',
    },
    {
      command: 'corepack pnpm --filter example-workspace-shared-host preview',
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: 'http://localhost:4201/',
    },
  ],
});
