import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';
import { getE2eLocalhostUrl, getE2eLoopbackUrl, getE2ePort } from '../../examples/e2ePorts.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');
const reactRemotePort = getE2ePort('REACT_REMOTE');
const reactRemoteManifestUrl = getE2eLocalhostUrl('REACT_REMOTE', '/mf-manifest.json');
const ssrHostPort = getE2ePort('SSR_HOST');

export default defineConfig({
  testDir: './e2e',
  testMatch: /ssr-manifest\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/ssr',
  use: {
    baseURL: getE2eLoopbackUrl('SSR_HOST'),
    headless: true,
  },
  webServer: [
    {
      command: `corepack pnpm --filter example-react-remote exec vite preview --host localhost --port ${reactRemotePort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('REACT_REMOTE'),
    },
    {
      command: 'corepack pnpm --filter example-react-ssr-host serve',
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(ssrHostPort),
        REACT_REMOTE_MANIFEST_URL: reactRemoteManifestUrl,
        REACT_REMOTE_MANIFEST_QUERY_OVERRIDES: '1',
      },
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLoopbackUrl('SSR_HOST', '/healthz'),
    },
  ],
});
