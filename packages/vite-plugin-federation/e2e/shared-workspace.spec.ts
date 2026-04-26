import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { expect, test } from '@playwright/test';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(e2eDir, '../../..');

test.describe('workspace shared dependencies', () => {
  test('loads a pnpm workspace symlinked shared package in production builds', async ({ page }) => {
    await page.goto('http://localhost:4201');

    await expect(page.getByTestId('host-report')).toHaveText('@mf-examples/workspace-shared@1.0.0');
    await expect(page.getByTestId('host-preload')).toHaveText(
      'pnpm-workspace-symlink:host-preload',
    );
    await expect(page.getByTestId('remote-report')).toHaveText(
      'pnpm-workspace-symlink:workspace-remote',
    );

    const runtimeDebug = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __WORKSPACE_SHARED_DEBUG__?: {
              runtime?: {
                sharedResolutionGraph?: Array<{
                  matchType?: string;
                  pkgName?: string;
                  requestedSourcePath?: string | null;
                  selected?: {
                    provider?: string | null;
                    sourcePath?: string | null;
                  } | null;
                  status?: string;
                }>;
              };
            };
          }
        ).__WORKSPACE_SHARED_DEBUG__,
    );
    const sharedResolution = runtimeDebug?.runtime?.sharedResolutionGraph
      ?.filter((entry) => entry.pkgName === '@mf-examples/workspace-shared/report')
      .at(-1);

    expect(sharedResolution).toMatchObject({
      matchType: 'exact',
      status: expect.stringMatching(/^(loaded|resolved)$/),
    });
    expect(
      sharedResolution?.selected?.sourcePath || sharedResolution?.requestedSourcePath || '',
    ).toContain('workspace-shared-lib/src/');

    const remoteDebug = JSON.parse(
      await readFile(
        path.join(repoRoot, 'examples/workspace-shared-remote/dist/mf-debug.json'),
        'utf8',
      ),
    );
    const remoteSharedDiagnostic = remoteDebug.diagnostics.sharedResolution.find(
      (entry: { key?: string }) => entry.key === '@mf-examples/workspace-shared/report',
    );

    expect(remoteSharedDiagnostic).toMatchObject({
      allowNodeModulesSuffixMatch: true,
      resolutionSource: expect.stringMatching(/^(project-root|workspace-ancestor)$/),
    });
    expect(remoteSharedDiagnostic.resolvedPackageEntry).toContain(
      'workspace-shared-lib/src/report.js',
    );
  });
});
