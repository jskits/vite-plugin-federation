import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { expect, test } from '@playwright/test';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(e2eDir, '../../..');
const remoteButtonFile = path.join(repoRoot, 'examples/react-remote/src/Button.jsx');
const remoteCardFile = path.join(repoRoot, 'examples/react-remote/src/Card.jsx');

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

test.describe('dev remote hmr', () => {
  test('updates static and runtime remotes without full page reload', async ({ page }) => {
    test.setTimeout(90_000);

    const runtimeConsoleIssues: string[] = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/already registered|removeRemote failed/i.test(text)) {
        runtimeConsoleIssues.push(text);
      }
    });

    await page.goto('/');

    await expect(
      page.getByRole('button', { name: 'Loaded from reactRemote/Button' })
    ).toBeVisible();
    await expect(page.locator('main')).toContainText('Runtime refresh count: 0');
    await expect(page.locator('main')).toContainText('Loaded through the runtime bridge API.');

    await page.evaluate(() => {
      sessionStorage.removeItem('__mf_beforeunload_seen');
      sessionStorage.removeItem('__mf_last_remote_update');

      window.addEventListener(
        'beforeunload',
        () => {
          sessionStorage.setItem('__mf_beforeunload_seen', '1');
        },
        { once: true }
      );

      window.addEventListener('vite-plugin-federation:remote-expose-update', (event) => {
        sessionStorage.setItem('__mf_last_remote_update', JSON.stringify(event.detail || null));
      });
    });

    const restoreTasks: Array<() => Promise<void>> = [];

    try {
      restoreTasks.push(
        await replaceFileOnce(
          remoteButtonFile,
          'return <button className="remote-button">{label}</button>;',
          'return <button className="remote-button">{label} / e2e static update</button>;'
        )
      );

      await expect(
        page.getByRole('button', { name: 'Loaded from reactRemote/Button / e2e static update' })
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('main')).toContainText('Runtime refresh count: 0');
      await expect
        .poll(async () => {
          const payload = await page.evaluate(() => sessionStorage.getItem('__mf_last_remote_update'));
          return payload ? JSON.parse(payload) : null;
        })
        .toMatchObject({
          expose: './Button',
          remoteRequestId: 'reactRemote/Button',
        });
      await expect
        .poll(async () => page.evaluate(() => sessionStorage.getItem('__mf_beforeunload_seen')))
        .toBeNull();

      restoreTasks.push(
        await replaceFileOnce(
          remoteCardFile,
          'Loaded through the runtime bridge API.',
          'Loaded through the runtime bridge API. / e2e runtime update'
        )
      );

      await expect(page.locator('main')).toContainText('Runtime refresh count: 1', {
        timeout: 15_000,
      });
      await expect(page.locator('main')).toContainText(
        'Loaded through the runtime bridge API. / e2e runtime update'
      );
      await expect
        .poll(async () => {
          const payload = await page.evaluate(() => sessionStorage.getItem('__mf_last_remote_update'));
          return payload ? JSON.parse(payload) : null;
        })
        .toMatchObject({
          expose: './Card',
          remoteRequestId: 'reactRemote/Card',
        });
      await expect
        .poll(async () => page.evaluate(() => sessionStorage.getItem('__mf_beforeunload_seen')))
        .toBeNull();

      expect(runtimeConsoleIssues).toEqual([]);
    } finally {
      await Promise.all(
        restoreTasks.reverse().map(async (restore) => {
          await restore();
        })
      );
    }
  });
});
