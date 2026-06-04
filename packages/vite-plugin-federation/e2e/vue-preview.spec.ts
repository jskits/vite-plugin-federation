import { expect, test } from '@playwright/test';

test.describe('Vue production preview', () => {
  test('mounts a Vue host with shared core depending on shared Vue', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        browserErrors.push(`[console:${message.type()}] ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      browserErrors.push(`[pageerror] ${error.message}`);
    });

    await page.goto('/');

    try {
      await expect(page.getByTestId('vue-host-ready')).toBeVisible();
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n\nBrowser errors:\n${browserErrors.join('\n') || '(none)'}`,
        { cause: error },
      );
    }

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Vue host consuming a manifest remote',
    );
    await expect(page.getByTestId('vue-core-host')).toContainText('vue-core:host');
    await expect(page.getByText('Loaded from vueRemote/RemoteBadge')).toBeVisible();
    await expect(page.getByText('Runtime loaded from vueRuntimeRemote/RemoteBadge')).toBeVisible();
    await expect(page.getByTestId('vue-core-remote').first()).toContainText('vue-core:remote');
  });
});
