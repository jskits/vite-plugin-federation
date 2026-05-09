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
  test('serves the devtools endpoint and renders the browser overlay contract', async ({
    page,
    request,
  }) => {
    const response = await request.get('/__mf_devtools');
    expect(response.ok()).toBe(true);
    const payload = await response.json();

    expect(payload).toMatchObject({
      capabilities: {
        copySnapshot: true,
        manifestTimeline: true,
        preloadGraph: true,
        remoteRegistry: true,
        runtimeErrors: true,
        sharedGraph: true,
      },
      contractVersion: '1.0.0',
      endpoint: '/__mf_devtools',
      name: 'reactHost',
      remoteHmrUrl: '/__mf_hmr',
      role: 'host',
    });
    expect(payload.remotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'reactRemote',
          name: 'reactRemote',
        }),
      ]),
    );

    await page.goto('/');

    const overlay = page.locator('#__vite_plugin_federation_devtools_overlay');
    await expect(overlay).toHaveCount(1);

    const contract = await page.evaluate(() => {
      const hook = (
        window as typeof window & {
          __VITE_PLUGIN_FEDERATION_DEVTOOLS__?: {
            apps?: Record<string, { role?: string }>;
            contractVersion?: string;
            exportSnapshot?: () => {
              contractVersion?: string;
              events?: Array<{ event?: string }>;
            };
          };
        }
      ).__VITE_PLUGIN_FEDERATION_DEVTOOLS__;

      return {
        appRole: hook?.apps?.reactHost?.role,
        contractVersion: hook?.contractVersion,
        exportSnapshotType: typeof hook?.exportSnapshot,
      };
    });

    expect(contract).toEqual({
      appRole: 'host',
      contractVersion: '1.0.0',
      exportSnapshotType: 'function',
    });

    await page.evaluate(() => {
      const overlay = document.getElementById('__vite_plugin_federation_devtools_overlay');
      if (overlay instanceof HTMLDetailsElement) {
        overlay.open = true;
      }

      window.dispatchEvent(
        new CustomEvent('vite-plugin-federation:debug', {
          detail: {
            event: 'e2e-devtools',
            snapshot: {
              runtime: {
                lastPreloadRemote: {
                  nameOrAlias: 'reactRemote',
                  resourceCategory: 'sync',
                },
                manifestFetches: [
                  {
                    attempt: 1,
                    manifestUrl: 'http://localhost/e2e-mf-manifest.json',
                    status: 'success',
                    timestamp: new Date().toISOString(),
                  },
                ],
                registeredManifestRemotes: [
                  {
                    alias: 'reactRemote',
                    entry: 'http://localhost/e2e-remoteEntry.js',
                    name: 'reactRemote',
                    shareScope: 'default',
                    target: 'web',
                  },
                ],
                registeredRemotes: [],
                sharedResolutionGraph: [
                  {
                    pkgName: 'react',
                    reason: 'e2e devtools overlay render',
                    selected: {
                      provider: 'host',
                      version: '19.2.4',
                    },
                    status: 'loaded',
                  },
                ],
              },
            },
          },
        }),
      );
    });

    await expect(overlay.locator('[data-mf-remotes]')).toContainText('reactRemote');
    await expect(overlay.locator('[data-mf-manifest-timeline]')).toContainText('success');
    await expect(overlay.locator('[data-mf-shared-graph]')).toContainText('react loaded');
    await expect(overlay.locator('[data-mf-preload-graph]')).toContainText('reactRemote');
    await expect(overlay.locator('[data-mf-events]')).toContainText('e2e-devtools');

    const snapshot = await page.evaluate(() => {
      return (
        window as typeof window & {
          __VITE_PLUGIN_FEDERATION_DEVTOOLS__?: {
            exportSnapshot?: () => {
              contractVersion?: string;
              events?: Array<{ event?: string }>;
            };
          };
        }
      ).__VITE_PLUGIN_FEDERATION_DEVTOOLS__?.exportSnapshot?.();
    });

    expect(snapshot).toMatchObject({
      contractVersion: '1.0.0',
      events: expect.arrayContaining([
        expect.objectContaining({
          event: 'e2e-devtools',
        }),
      ]),
    });
  });

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
      page.getByRole('button', { name: 'Loaded from reactRemote/Button' }),
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
        { once: true },
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
          'return <button className="remote-button">{label} / e2e static update</button>;',
        ),
      );

      await expect(
        page.getByRole('button', { name: 'Loaded from reactRemote/Button / e2e static update' }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('main')).toContainText('Runtime refresh count: 0');
      await expect
        .poll(async () => {
          const payload = await page.evaluate(() =>
            sessionStorage.getItem('__mf_last_remote_update'),
          );
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
          'Loaded through the runtime bridge API. / e2e runtime update',
        ),
      );

      await expect(page.locator('main')).toContainText('Runtime refresh count: 1', {
        timeout: 15_000,
      });
      await expect(page.locator('main')).toContainText(
        'Loaded through the runtime bridge API. / e2e runtime update',
      );
      await expect
        .poll(async () => {
          const payload = await page.evaluate(() =>
            sessionStorage.getItem('__mf_last_remote_update'),
          );
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
        }),
      );
    }
  });
});
