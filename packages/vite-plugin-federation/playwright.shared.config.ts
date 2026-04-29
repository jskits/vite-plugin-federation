import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';
import { getE2eLocalhostUrl, getE2ePort } from '../../examples/e2ePorts.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');
const sharedStrictFallbackPort = getE2ePort('SHARED_STRICT_FALLBACK');
const sharedHostOnlyRemotePort = getE2ePort('SHARED_HOST_ONLY_REMOTE');
const sharedHostOnlyHostPort = getE2ePort('SHARED_HOST_ONLY_HOST');
const sharedNegotiationLoadedRemotePort = getE2ePort('SHARED_NEGOTIATION_LOADED_REMOTE');
const sharedNegotiationLoadedHostPort = getE2ePort('SHARED_NEGOTIATION_LOADED_HOST');
const sharedNegotiationVersionRemotePort = getE2ePort('SHARED_NEGOTIATION_VERSION_REMOTE');
const sharedNegotiationVersionHostPort = getE2ePort('SHARED_NEGOTIATION_VERSION_HOST');
const workspaceSharedRemotePort = getE2ePort('WORKSPACE_SHARED_REMOTE');
const workspaceSharedHostPort = getE2ePort('WORKSPACE_SHARED_HOST');

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
      command: `corepack pnpm --filter example-shared-strict-fallback-app exec vite preview --host localhost --port ${sharedStrictFallbackPort} --outDir dist`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('SHARED_STRICT_FALLBACK'),
    },
    {
      command: `corepack pnpm --filter example-shared-host-only-remote exec vite preview --host localhost --port ${sharedHostOnlyRemotePort} --outDir dist`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('SHARED_HOST_ONLY_REMOTE'),
    },
    {
      command: `corepack pnpm --filter example-shared-host-only-host exec vite preview --host localhost --port ${sharedHostOnlyHostPort} --outDir dist`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('SHARED_HOST_ONLY_HOST'),
    },
    {
      command: `corepack pnpm --filter example-shared-negotiation-remote exec vite preview --host localhost --port ${sharedNegotiationLoadedRemotePort} --outDir dist-loaded-first`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('SHARED_NEGOTIATION_LOADED_REMOTE'),
    },
    {
      command: `corepack pnpm --filter example-shared-negotiation-host exec vite preview --host localhost --port ${sharedNegotiationLoadedHostPort} --outDir dist-loaded-first`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('SHARED_NEGOTIATION_LOADED_HOST'),
    },
    {
      command: `corepack pnpm --filter example-shared-negotiation-remote exec vite preview --host localhost --port ${sharedNegotiationVersionRemotePort} --outDir dist-version-first`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('SHARED_NEGOTIATION_VERSION_REMOTE'),
    },
    {
      command: `corepack pnpm --filter example-shared-negotiation-host exec vite preview --host localhost --port ${sharedNegotiationVersionHostPort} --outDir dist-version-first`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('SHARED_NEGOTIATION_VERSION_HOST'),
    },
    {
      command: `corepack pnpm --filter example-workspace-shared-remote exec vite preview --host localhost --port ${workspaceSharedRemotePort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('WORKSPACE_SHARED_REMOTE'),
    },
    {
      command: `corepack pnpm --filter example-workspace-shared-host exec vite preview --host localhost --port ${workspaceSharedHostPort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('WORKSPACE_SHARED_HOST'),
    },
  ],
});
