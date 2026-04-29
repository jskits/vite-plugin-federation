import { expect, test } from '@playwright/test';
import { getE2eLocalhostUrl } from '../../../examples/e2ePorts.mjs';

const scenarios = [
  {
    expectedProvider: 'host',
    expectedVersion: '1.0.0',
    hostUrl: getE2eLocalhostUrl('SHARED_NEGOTIATION_LOADED_HOST'),
    name: 'loaded-first',
  },
  {
    expectedProvider: 'remote',
    expectedVersion: '2.0.0',
    hostUrl: getE2eLocalhostUrl('SHARED_NEGOTIATION_VERSION_HOST'),
    name: 'version-first',
  },
] as const;

test.describe('shared version negotiation', () => {
  for (const scenario of scenarios) {
    test(`${scenario.name} selects the deterministic shared provider in production builds`, async ({
      page,
    }) => {
      const diagnostics: string[] = [];

      page.on('console', (message) => {
        diagnostics.push(`[console:${message.type()}] ${message.text()}`);
      });
      page.on('pageerror', (error) => {
        diagnostics.push(`[pageerror] ${error.message}`);
      });
      page.on('requestfailed', (request) => {
        diagnostics.push(
          `[requestfailed] ${request.url()} ${request.failure()?.errorText || ''}`.trim(),
        );
      });
      page.on('response', (response) => {
        const url = response.url();
        if (
          /(?:mf-manifest|remoteEntry|Widget|loadShare|shared-value|virtual_mf|localSharedImportMap)/.test(
            url,
          )
        ) {
          diagnostics.push(`[response:${response.status()}] ${url}`);
        }
      });

      await page.goto(scenario.hostUrl);

      await expect(page.getByTestId('scenario')).toHaveText(scenario.name);
      try {
        await expect(page.getByTestId('remote-report')).toHaveText(
          `remote resolved ${scenario.expectedProvider}@${scenario.expectedVersion}`,
          { timeout: 10_000 },
        );
      } catch (error) {
        const debugSnapshot = await page.evaluate(() => ({
          devtools: (
            window as unknown as {
              __VITE_PLUGIN_FEDERATION_DEVTOOLS__?: unknown;
            }
          ).__VITE_PLUGIN_FEDERATION_DEVTOOLS__,
          debug: (
            window as unknown as {
              __SHARED_NEGOTIATION_DEBUG__?: unknown;
            }
          ).__SHARED_NEGOTIATION_DEBUG__,
          federationInstanceCount:
            (
              globalThis as unknown as {
                __FEDERATION__?: {
                  __INSTANCES__?: unknown[];
                };
              }
            ).__FEDERATION__?.__INSTANCES__?.length || 0,
          text: document.body.textContent,
        }));
        await test.info().attach(`${scenario.name}-diagnostics.json`, {
          body: JSON.stringify({ diagnostics, debugSnapshot }, null, 2),
          contentType: 'application/json',
        });
        throw error;
      }

      const debugInfo = await page.evaluate(
        () =>
          (
            window as unknown as {
              __SHARED_NEGOTIATION_DEBUG__?: {
                runtime?: {
                  sharedResolutionGraph?: Array<{
                    pkgName?: string;
                    selected?: {
                      provider?: string | null;
                      version?: string;
                    } | null;
                    status?: string;
                    strategy?: string;
                  }>;
                };
              };
            }
          ).__SHARED_NEGOTIATION_DEBUG__,
      );

      const resolution = debugInfo?.runtime?.sharedResolutionGraph
        ?.filter(
          (entry) =>
            entry.pkgName === '@mf-e2e/shared-value' &&
            (entry.status === 'loaded' || entry.status === 'resolved'),
        )
        .at(-1);

      expect(resolution).toMatchObject({
        selected: {
          version: scenario.expectedVersion,
        },
        strategy: scenario.name,
      });
    });
  }
});
