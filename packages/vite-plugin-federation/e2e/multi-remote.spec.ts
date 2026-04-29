import { expect, test } from '@playwright/test';
import { getE2eLocalhostUrl } from '../../../examples/e2ePorts.mjs';

const hostUrl = getE2eLocalhostUrl('MULTI_REMOTE_HOST');
const litRemoteManifestUrl = getE2eLocalhostUrl('LIT_REMOTE', '/mf-manifest.json');
const reactRemoteManifestUrl = getE2eLocalhostUrl('REACT_REMOTE', '/mf-manifest.json');

test.describe('multi-remote manifest host', () => {
  test('loads React and Lit remotes from one host runtime', async ({ page }) => {
    await page.goto(hostUrl);

    await expect(page.getByTestId('react-remote-panel')).toContainText('React manifest remote');
    await expect(
      page.getByRole('button', { name: 'Loaded from reactRemote/Button' }),
    ).toBeVisible();
    await expect(page.getByTestId('lit-remote-panel')).toContainText('Lit manifest remote');
    await expect(page.locator('remote-lit-card')).toBeVisible();

    const debugInfo = await page.evaluate(() => {
      return (
        window as typeof window & {
          __VITE_PLUGIN_FEDERATION_DEVTOOLS__?: {
            runtime?: {
              runtime?: {
                registeredManifestRemotes?: Array<{
                  alias: string;
                  manifestUrl: string;
                  name: string;
                }>;
              };
            };
          };
        }
      ).__VITE_PLUGIN_FEDERATION_DEVTOOLS__?.runtime;
    });

    expect(debugInfo?.runtime?.registeredManifestRemotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'reactRemote',
          manifestUrl: reactRemoteManifestUrl,
        }),
        expect.objectContaining({
          alias: 'litRemote',
          manifestUrl: litRemoteManifestUrl,
        }),
      ]),
    );
  });
});
