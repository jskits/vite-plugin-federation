import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { getE2eLocalhostUrl } from '../../../examples/e2ePorts.mjs';

const remoteManifestUrl = getE2eLocalhostUrl('REACT_REMOTE', '/mf-manifest.json');
const remoteAssetBaseUrl = getE2eLocalhostUrl('REACT_REMOTE', '/assets/Button-');
const missingRemoteManifestUrl = getE2eLocalhostUrl('REACT_REMOTE', '/missing-mf-manifest.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

interface SsrFederationDebug {
  manifestUrl: string;
  manifestSourceUrl?: string;
  react: {
    version: string;
  };
  registeredRemote?: {
    entry?: string;
    manifestUrl?: string;
    shareScope?: string;
    sourceUrl?: string;
    target?: string;
  };
  remoteAlias: string;
  remoteId: string;
  shareScope: string;
  target: string;
}

test.describe('ssr manifest consumption', () => {
  test('server-renders and hydrates a manifest remote', async ({ page, request }) => {
    test.setTimeout(90_000);

    const htmlResponse = await request.get('/');
    expect(htmlResponse.ok()).toBe(true);

    const html = await htmlResponse.text();
    expect(html).toContain('SSR rendered via Node runtime');
    expect(html).toContain(`window.__REMOTE_MANIFEST_URL__ = "${remoteManifestUrl}"`);
    expect(html).toContain('window.__SSR_FEDERATION_DEBUG__ = ');
    expect(html).toContain('"target":"node"');
    expect(html).toContain(`data-mf-href="${remoteAssetBaseUrl}`);
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

    const ssrDebug = await page.evaluate<SsrFederationDebug>(
      () =>
        (window as unknown as { __SSR_FEDERATION_DEBUG__?: SsrFederationDebug })
          .__SSR_FEDERATION_DEBUG__!,
    );
    const hydrationDebugHandle = await page.waitForFunction(
      () => (window as unknown as { __SSR_HYDRATION_DEBUG__?: unknown }).__SSR_HYDRATION_DEBUG__,
    );
    const hydrationDebug = (await hydrationDebugHandle.jsonValue()) as SsrFederationDebug;

    expect(ssrDebug).toMatchObject({
      manifestUrl: remoteManifestUrl,
      remoteAlias: 'reactRemote',
      remoteId: 'reactRemote/Button',
      shareScope: 'default',
      target: 'node',
    });
    expect(ssrDebug.registeredRemote).toMatchObject({
      entry: expect.stringContaining('/ssr/'),
      manifestUrl: remoteManifestUrl,
      shareScope: 'default',
      target: 'node',
    });
    expect(ssrDebug.preloadLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetType: 'js',
          href: expect.stringContaining(remoteAssetBaseUrl),
          rel: 'modulepreload',
        }),
      ]),
    );

    expect(hydrationDebug).toMatchObject({
      manifestUrl: ssrDebug.manifestUrl,
      remoteAlias: ssrDebug.remoteAlias,
      remoteId: ssrDebug.remoteId,
      shareScope: ssrDebug.shareScope,
      target: 'web',
    });
    expect(hydrationDebug.react.version).toBe(ssrDebug.react.version);
    expect(hydrationDebug.registeredRemote).toMatchObject({
      entry: expect.stringContaining('/remoteEntry.js'),
      manifestUrl: remoteManifestUrl,
      shareScope: 'default',
      target: 'web',
    });
    expect(consoleErrors.filter((message) => !message.includes('favicon.ico'))).toEqual([]);
  });

  test('falls back to a secondary manifest URL during SSR and hydration', async ({
    page,
    request,
  }) => {
    const fallbackPath = `/?manifestUrl=${encodeURIComponent(
      missingRemoteManifestUrl,
    )}&fallbackUrl=${encodeURIComponent(remoteManifestUrl)}&forceManifest=1`;

    const htmlResponse = await request.get(fallbackPath);
    expect(htmlResponse.ok()).toBe(true);

    const html = await htmlResponse.text();
    expect(html).toContain(`window.__REMOTE_MANIFEST_URL__ = "${missingRemoteManifestUrl}"`);
    expect(html).toContain(`window.__REMOTE_MANIFEST_FALLBACK_URLS__ = ["${remoteManifestUrl}"]`);
    expect(html).toContain(`"manifestSourceUrl":"${remoteManifestUrl}"`);
    expect(html).toContain(`data-mf-href="${remoteAssetBaseUrl}`);

    await page.goto(fallbackPath);
    await expect(page.getByRole('button', { name: 'SSR rendered via Node runtime' })).toBeVisible();

    const ssrDebug = await page.evaluate<SsrFederationDebug>(
      () =>
        (window as unknown as { __SSR_FEDERATION_DEBUG__?: SsrFederationDebug })
          .__SSR_FEDERATION_DEBUG__!,
    );
    const hydrationDebugHandle = await page.waitForFunction(
      () => (window as unknown as { __SSR_HYDRATION_DEBUG__?: unknown }).__SSR_HYDRATION_DEBUG__,
    );
    const hydrationDebug = (await hydrationDebugHandle.jsonValue()) as SsrFederationDebug;

    expect(ssrDebug).toMatchObject({
      manifestSourceUrl: remoteManifestUrl,
      manifestUrl: missingRemoteManifestUrl,
      target: 'node',
    });
    expect(ssrDebug.registeredRemote).toMatchObject({
      manifestUrl: missingRemoteManifestUrl,
      sourceUrl: remoteManifestUrl,
      target: 'node',
    });
    expect(hydrationDebug).toMatchObject({
      manifestUrl: missingRemoteManifestUrl,
      target: 'web',
    });
    expect(hydrationDebug.registeredRemote).toMatchObject({
      manifestUrl: missingRemoteManifestUrl,
      sourceUrl: remoteManifestUrl,
      target: 'web',
    });
  });

  test('returns a clear 500 when every SSR manifest source fails', async ({ request }) => {
    const failurePath = `/?manifestUrl=${encodeURIComponent(
      missingRemoteManifestUrl,
    )}&forceManifest=1`;

    const htmlResponse = await request.get(failurePath);
    expect(htmlResponse.status()).toBe(500);

    const body = await htmlResponse.text();
    expect(body).toContain('Failed to fetch federation manifest');
    expect(body).toContain(missingRemoteManifestUrl);
  });

  test('rejects SSR manifest query overrides outside the configured origin allowlist', async ({
    request,
  }) => {
    const disallowedManifestUrl = 'http://127.0.0.1:1/mf-manifest.json';
    const response = await request.get(
      `/?manifestUrl=${encodeURIComponent(disallowedManifestUrl)}&forceManifest=1`,
    );

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('manifestUrl origin is not allowed');
  });

  test('keeps the SSR bundling and remote entry contracts explicit', async () => {
    const hostServerEntry = await readFile(
      path.join(repoRoot, 'examples/react-ssr-host/dist/server/server-entry.js'),
      'utf-8',
    );
    const remoteManifest = JSON.parse(
      await readFile(path.join(repoRoot, 'examples/react-remote/dist/mf-manifest.json'), 'utf-8'),
    );

    expect(hostServerEntry).toContain('vite-plugin-federation/runtime');
    expect(remoteManifest.metaData.remoteEntry).toMatchObject({
      name: 'remoteEntry.js',
      type: 'module',
    });
    expect(remoteManifest.metaData.ssrRemoteEntry).toMatchObject({
      path: 'ssr',
      type: 'module',
    });
  });
});
