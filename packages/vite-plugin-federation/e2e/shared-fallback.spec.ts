import { expect, test } from '@playwright/test';

test.describe('shared fallback diagnostics', () => {
  test('records strictVersion local fallback decisions in browser builds', async ({ page }) => {
    await page.goto('http://localhost:4190');

    await expect(page.getByTestId('result')).toHaveText('local fallback local@1.0.0');

    const debugInfo = await page.evaluate(
      () =>
        (
          window as unknown as {
            __SHARED_FALLBACK_DEBUG__?: {
              result?: boolean;
              runtime?: {
                runtime?: {
                  sharedResolutionGraph?: Array<{
                    fallbackSource?: string;
                    pkgName?: string;
                    status?: string;
                    strictVersion?: boolean;
                  }>;
                };
              };
            };
          }
        ).__SHARED_FALLBACK_DEBUG__,
    );

    expect(debugInfo?.result).toBe(false);
    expect(
      debugInfo?.runtime?.runtime?.sharedResolutionGraph
        ?.filter((entry) => entry.pkgName === '@mf-e2e/strict-fallback')
        .at(-1),
    ).toMatchObject({
      fallbackSource: 'local-fallback',
      pkgName: '@mf-e2e/strict-fallback',
      status: 'fallback',
      strictVersion: true,
    });
  });

  test('surfaces actionable host-only shared provider errors in browser builds', async ({
    page,
  }) => {
    await page.goto('http://localhost:4192');

    await expect(page.getByTestId('status')).toContainText(
      'must be provided by the host because import: false is configured',
    );

    const debugInfo = await page.evaluate(
      () =>
        (
          window as unknown as {
            __HOST_ONLY_SHARED_DEBUG__?: {
              runtime?: {
                sharedResolutionGraph?: Array<{
                  fallbackSource?: string;
                  pkgName?: string;
                  requiredVersion?: string | false;
                  status?: string;
                  strictVersion?: boolean;
                }>;
              };
            };
          }
        ).__HOST_ONLY_SHARED_DEBUG__,
    );

    expect(
      debugInfo?.runtime?.sharedResolutionGraph
        ?.filter((entry) => entry.pkgName === 'host-only-dep')
        .at(-1),
    ).toMatchObject({
      fallbackSource: 'host-only',
      pkgName: 'host-only-dep',
      requestedVersion: '^1.2.3',
      status: 'fallback',
      strictVersion: true,
    });
  });
});
