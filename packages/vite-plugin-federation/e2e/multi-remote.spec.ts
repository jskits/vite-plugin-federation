import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { getE2eLocalhostUrl } from '../../../examples/e2ePorts.mjs';

const hostUrl = getE2eLocalhostUrl('MULTI_REMOTE_HOST');
const litRemoteManifestUrl = getE2eLocalhostUrl('LIT_REMOTE', '/mf-manifest.json');
const reactRemoteManifestUrl = getE2eLocalhostUrl('REACT_REMOTE', '/mf-manifest.json');

interface ManifestRemoteEntry {
  contentHash?: string;
  integrity?: string;
  name: string;
  path?: string;
}

interface FederationRemoteManifest {
  metaData: {
    publicPath?: string;
    remoteEntry: ManifestRemoteEntry;
  };
}

interface ManifestIntegrityCheck {
  actualContentHash?: string;
  actualIntegrity?: string;
  assetUrl: string;
  error?: string;
  expectedContentHash?: string;
  expectedIntegrity?: string;
  manifestUrl: string;
  mode: string;
  status: 'failure' | 'success';
  target: string;
  verifiedWith: string[];
}

interface FederationDebugInfo {
  runtime?: {
    manifestIntegrityChecks?: ManifestIntegrityCheck[];
    registeredManifestRemotes?: Array<{
      alias: string;
      manifestUrl: string;
      name: string;
    }>;
  };
}

interface SecurityE2eApi {
  getDebugInfo(): FederationDebugInfo;
  loadReactButtonWithIntegrity(
    manifestUrl: string,
    integrity: boolean | { mode: string },
  ): Promise<{
    debugInfo: FederationDebugInfo;
    exportType: string;
  }>;
}

function addManifestQuery(manifestUrl: string, e2eCase: string) {
  const url = new URL(manifestUrl);
  url.searchParams.set('e2eCase', e2eCase);
  return url.href;
}

function joinUrlPath(...parts: Array<string | undefined>) {
  return parts
    .map((part) => (part || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

function resolveManifestRemoteEntryUrl(manifestUrl: string, manifest: FederationRemoteManifest) {
  const remoteEntry = manifest.metaData.remoteEntry;
  const entryPath = joinUrlPath(remoteEntry.path, remoteEntry.name);
  const publicPath = manifest.metaData.publicPath;

  if (publicPath && publicPath !== 'auto') {
    return new URL(entryPath, new URL(publicPath, manifestUrl)).href;
  }

  return new URL(entryPath, manifestUrl).href;
}

async function fetchReactRemoteManifest(request: APIRequestContext) {
  const response = await request.get(reactRemoteManifestUrl);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as FederationRemoteManifest;
}

async function getSecurityE2eApi(page: Page) {
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        return typeof (window as typeof window & { __MF_SECURITY_E2E__?: SecurityE2eApi })
          .__MF_SECURITY_E2E__;
      });
    })
    .toBe('object');
}

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

  test('verifies remoteEntry integrity and contentHash before loading a manifest remote', async ({
    page,
  }) => {
    await page.goto(hostUrl);
    await getSecurityE2eApi(page);

    const manifestUrl = addManifestQuery(reactRemoteManifestUrl, 'integrity-success');
    const result = await page.evaluate(async (url) => {
      return (
        window as typeof window & { __MF_SECURITY_E2E__: SecurityE2eApi }
      ).__MF_SECURITY_E2E__.loadReactButtonWithIntegrity(url, { mode: 'both' });
    }, manifestUrl);

    const integrityChecks = result.debugInfo.runtime?.manifestIntegrityChecks ?? [];
    const latestCheck = integrityChecks.at(-1);

    expect(result.exportType).toBe('function');
    expect(latestCheck).toEqual(
      expect.objectContaining({
        assetUrl: expect.stringContaining('/remoteEntry.js'),
        manifestUrl,
        mode: 'both',
        status: 'success',
        target: 'web',
        verifiedWith: ['integrity', 'contentHash'],
      }),
    );
    expect(latestCheck?.actualIntegrity).toBe(latestCheck?.expectedIntegrity);
    expect(latestCheck?.actualContentHash).toBe(latestCheck?.expectedContentHash);
  });

  test('rejects a tampered remoteEntry before runtime registration', async ({ page, request }) => {
    const manifest = await fetchReactRemoteManifest(request);
    const remoteEntryUrl = resolveManifestRemoteEntryUrl(reactRemoteManifestUrl, manifest);
    const remoteEntryResponse = await request.get(remoteEntryUrl);
    expect(remoteEntryResponse.ok()).toBeTruthy();
    const remoteEntrySource = await remoteEntryResponse.text();

    await page.goto(hostUrl);
    await getSecurityE2eApi(page);

    await page.route(remoteEntryUrl, (route) => {
      return route.fulfill({
        body: `${remoteEntrySource}\n/* tampered by integrity e2e */\n`,
        contentType: 'text/javascript',
        headers: {
          'access-control-allow-origin': '*',
        },
        status: 200,
      });
    });

    const manifestUrl = addManifestQuery(reactRemoteManifestUrl, 'tampered-remote-entry');
    const result = await page.evaluate(async (url) => {
      try {
        await (
          window as typeof window & { __MF_SECURITY_E2E__: SecurityE2eApi }
        ).__MF_SECURITY_E2E__.loadReactButtonWithIntegrity(url, { mode: 'both' });
        return { ok: true };
      } catch (error) {
        return {
          debugInfo: (
            window as typeof window & { __MF_SECURITY_E2E__: SecurityE2eApi }
          ).__MF_SECURITY_E2E__.getDebugInfo(),
          message: error instanceof Error ? error.message : String(error),
          ok: false,
        };
      }
    }, manifestUrl);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('failed integrity verification');

    const latestCheck = result.debugInfo?.runtime?.manifestIntegrityChecks?.at(-1);
    expect(latestCheck).toEqual(
      expect.objectContaining({
        assetUrl: remoteEntryUrl,
        manifestUrl,
        mode: 'both',
        status: 'failure',
        target: 'web',
        verifiedWith: ['integrity'],
      }),
    );
    expect(latestCheck?.actualIntegrity).not.toBe(latestCheck?.expectedIntegrity);
  });
});
