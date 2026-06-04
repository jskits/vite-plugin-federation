import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';
import { getE2eLocalhostUrl, getE2ePort } from '../../examples/e2ePorts.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');
const vueDevRemotePort = getE2ePort('VUE_DEV_REMOTE');
const vueDevHostPort = getE2ePort('VUE_DEV_HOST');
const vueDevRemoteOrigin = getE2eLocalhostUrl('VUE_DEV_REMOTE').replace(/\/$/, '');
const vueDevManifestUrl = getE2eLocalhostUrl('VUE_DEV_REMOTE', '/mf-manifest.json');

function withEnv(command: string, env: Record<string, string>) {
  const assignments = Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  return `${assignments} ${command}`;
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /vue-hmr\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/vue',
  use: {
    baseURL: getE2eLocalhostUrl('VUE_DEV_HOST'),
    headless: true,
  },
  webServer: [
    {
      command: `corepack pnpm --filter example-vue-remote exec vite --host localhost --port ${vueDevRemotePort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('VUE_DEV_REMOTE'),
    },
    {
      command: withEnv(
        `corepack pnpm --filter example-vue-host exec vite --host localhost --port ${vueDevHostPort}`,
        {
          MF_E2E_VUE_REMOTE_ORIGIN: vueDevRemoteOrigin,
          VITE_VUE_REMOTE_MANIFEST_URL: vueDevManifestUrl,
        },
      ),
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      url: getE2eLocalhostUrl('VUE_DEV_HOST'),
    },
  ],
});
