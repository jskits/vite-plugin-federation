import { expect, test } from '@playwright/test';

test.describe('originjs compatibility shim', () => {
  test('loads remoteEntry-first and manifest-first remotes on the same host', async ({ page }) => {
    await page.goto('http://localhost:4193');

    await expect(page.getByTestId('status')).toHaveText('ready');
    await expect(page.getByTestId('esm-ensure')).toHaveText('container-ready');
    await expect(page.getByTestId('var-ensure')).toHaveText('container-ready');
    await expect(page.getByTestId('manifest-registration')).toHaveText('manifest-registered');
    await expect(page.getByTestId('helper-wrap')).toHaveText('default');
    await expect(page.getByTestId('helper-unwrap')).toHaveText('compat-ok');
    await expect(page.getByRole('button', { name: 'OriginJS ESM Button' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manifest Button' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'OriginJS VAR Button' })).toBeVisible();

    const debugInfo = await page.evaluate(() => {
      return (
        window as typeof window & {
          __ORIGINJS_COMPAT_DEBUG__?: {
            esm?: {
              containerReady?: boolean;
              entry?: string;
              request?: string;
              resolvedType?: string;
            };
            helpers?: {
              unwrapValue?: string;
              wrappedHasDefault?: boolean;
            };
            manifest?: {
              entry?: string;
              registeredAlias?: string | null;
              registeredEntry?: string | null;
              request?: string;
              resolvedType?: string;
            };
            var?: {
              containerReady?: boolean;
              entry?: string;
              request?: string;
              resolvedType?: string;
            };
          };
        }
      ).__ORIGINJS_COMPAT_DEBUG__;
    });

    expect(debugInfo).toMatchObject({
      esm: {
        containerReady: true,
        entry: 'http://localhost:4174/remoteEntry.js',
        request: 'reactRemote/Button',
        resolvedType: 'function',
      },
      helpers: {
        unwrapValue: 'compat-ok',
        wrappedHasDefault: true,
      },
      manifest: {
        entry: 'http://localhost:4174/mf-manifest.json',
        registeredAlias: 'reactManifest',
        request: 'reactManifest/Button',
        resolvedType: 'function',
      },
      var: {
        containerReady: true,
        entry: 'http://localhost:4174/remoteEntry.var.js',
        request: 'reactRemoteVar/Button',
        resolvedType: 'function',
      },
    });
  });
});
