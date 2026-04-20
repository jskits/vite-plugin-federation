import { describe, expect, it } from 'vitest';

import { vi } from 'vitest';

vi.mock('../../utils/normalizeModuleFederationOptions', () => ({
  getNormalizeModuleFederationOptions: () => ({
    internalName: '__mfe_internal__host',
    virtualModuleDir: '__mf__virtual',
  }),
}));

import { generateRemotes } from '../virtualRemotes';

describe('generateRemotes', () => {
  it('adds a dev hmr self-accept bridge for serve esm remotes', () => {
    const code = generateRemotes('reactRemote/Button', 'serve', true);

    expect(code).toContain('import.meta.hot.accept()');
    expect(code).toContain('__mf_shouldRefreshRemote');
    expect(code).toContain('await __mf_refreshRemote("reactRemote/Button")');
  });

  it('does not add a dev hmr self-accept bridge for build output', () => {
    const code = generateRemotes('reactRemote/Button', 'build', true);

    expect(code).not.toContain('import.meta.hot.accept()');
    expect(code).not.toContain('__mf_shouldRefreshRemote');
  });
});
