import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from '@playwright/test';
import { getE2eLocalhostUrl, getE2ePort } from '../../examples/e2ePorts.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');
const vuePreviewRemotePort = getE2ePort('VUE_PREVIEW_REMOTE');
const vuePreviewHostPort = getE2ePort('VUE_PREVIEW_HOST');
const vuePreviewRemoteOrigin = getE2eLocalhostUrl('VUE_PREVIEW_REMOTE').replace(/\/$/, '');
const vuePreviewManifestUrl = getE2eLocalhostUrl('VUE_PREVIEW_REMOTE', '/mf-manifest.json');

function withEnv(command: string, env: Record<string, string>) {
  const assignments = Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
  return `${assignments} ${command}`;
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /vue-preview\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/vue-preview',
  use: {
    baseURL: getE2eLocalhostUrl('VUE_PREVIEW_HOST'),
    headless: true,
  },
  webServer: [
    {
      command:
        `corepack pnpm --filter example-vue-remote build && ` +
        `corepack pnpm --filter example-vue-remote exec vite preview --host localhost --port ${vuePreviewRemotePort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 90_000,
      url: getE2eLocalhostUrl('VUE_PREVIEW_REMOTE'),
    },
    {
      command:
        withEnv(`corepack pnpm --filter example-vue-host build`, {
          MF_E2E_VUE_REMOTE_ORIGIN: vuePreviewRemoteOrigin,
          VITE_VUE_REMOTE_MANIFEST_URL: vuePreviewManifestUrl,
        }) +
        ` && corepack pnpm --filter example-vue-host exec vite preview --host localhost --port ${vuePreviewHostPort}`,
      cwd: repoRoot,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 90_000,
      url: getE2eLocalhostUrl('VUE_PREVIEW_HOST'),
    },
  ],
});
