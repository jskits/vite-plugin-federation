import { expect, test } from '@playwright/test';

const remoteManifestUrl = 'http://localhost:4174/mf-manifest.json';

test.describe('ssr manifest consumption', () => {
  test('server-renders and hydrates a manifest remote', async ({ page, request }) => {
    test.setTimeout(90_000);

    const htmlResponse = await request.get('/');
    expect(htmlResponse.ok()).toBe(true);

    const html = await htmlResponse.text();
    expect(html).toContain('SSR rendered via Node runtime');
    expect(html).toContain(`window.__REMOTE_MANIFEST_URL__ = "${remoteManifestUrl}"`);
    expect(html).toContain('data-mf-href="http://localhost:4174/assets/Button-');
    expect(html).toContain('rel="modulepreload" crossorigin="anonymous"');

    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.goto('/');

    await expect(page.getByRole('button', { name: 'SSR rendered via Node runtime' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Server Rendering + Federation Runtime');
    await expect(page.locator('link[data-mf-href*="/assets/Button-"]')).toHaveCount(1);
    await expect
      .poll(async () =>
        page.evaluate(
          () => (window as unknown as { __REMOTE_MANIFEST_URL__?: string }).__REMOTE_MANIFEST_URL__,
        ),
      )
      .toBe(remoteManifestUrl);
    expect(consoleErrors.filter((message) => !message.includes('favicon.ico'))).toEqual([]);
  });
});
