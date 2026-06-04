import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(e2eDir, '../../..');
const hostAppFile = path.join(repoRoot, 'examples/vue-host/src/App.vue');
const remoteBadgeFile = path.join(repoRoot, 'examples/vue-remote/src/RemoteBadge.vue');

async function replaceFileOnce(filePath: string, searchValue: string, replaceValue: string) {
  const original = await fs.readFile(filePath, 'utf8');
  if (!original.includes(searchValue)) {
    throw new Error(`Expected to find "${searchValue}" in ${filePath}.`);
  }

  await fs.writeFile(filePath, original.replace(searchValue, replaceValue), 'utf8');

  return async () => {
    await fs.writeFile(filePath, original, 'utf8');
  };
}

async function watchForFullReload(page: Page) {
  await page.evaluate(() => {
    sessionStorage.removeItem('__mf_vue_beforeunload_seen');
    window.addEventListener(
      'beforeunload',
      () => {
        sessionStorage.setItem('__mf_vue_beforeunload_seen', '1');
      },
      { once: true },
    );
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('Vue dev HMR', () => {
  test('patches host App.vue after a static remote has rendered', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto('/');
    await expect(page.getByText('Loaded from vueRemote/RemoteBadge')).toBeVisible();
    await expect(page.getByText('Runtime loaded from vueRuntimeRemote/RemoteBadge')).toBeVisible();
    await watchForFullReload(page);

    const restore = await replaceFileOnce(
      hostAppFile,
      'Vue host consuming a manifest remote',
      'Vue host consuming a manifest remote / e2e host hmr',
    );

    try {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Vue host consuming a manifest remote / e2e host hmr',
        { timeout: 15_000 },
      );
      await expect(page.getByText('Loaded from vueRemote/RemoteBadge')).toBeVisible();
      await expect
        .poll(async () => page.evaluate(() => sessionStorage.getItem('__mf_vue_beforeunload_seen')))
        .toBeNull();
    } finally {
      await restore();
    }
  });

  test('patches a runtime-only remote Vue SFC without a full page reload', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto('/');
    await expect(page.getByText('Runtime loaded from vueRuntimeRemote/RemoteBadge')).toBeVisible();
    await expect(page.getByTestId('vue-core-remote').first()).toContainText('vue-core:remote');
    await watchForFullReload(page);

    const restore = await replaceFileOnce(
      remoteBadgeFile,
      'Shared Vue singleton resolution is exercised through this federated component.',
      'Shared Vue singleton resolution is exercised through this federated component. / e2e runtime sfc hmr',
    );

    try {
      await expect(page.getByTestId('vue-remote-copy').last()).toContainText(
        'e2e runtime sfc hmr',
        { timeout: 15_000 },
      );
      await expect
        .poll(async () => page.evaluate(() => sessionStorage.getItem('__mf_vue_beforeunload_seen')))
        .toBeNull();
    } finally {
      await restore();
    }
  });
});
