import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addUsedRemoteMock,
  getDevRemoteVersionMock,
  getInstalledPackageEntryMock,
  getIsRolldownMock,
  getRemoteVirtualModuleMock,
  remoteModulePath,
} = vi.hoisted(() => ({
  addUsedRemoteMock: vi.fn(),
  getDevRemoteVersionMock: vi.fn(() => undefined),
  getInstalledPackageEntryMock: vi.fn(() => undefined),
  getIsRolldownMock: vi.fn(() => true),
  getRemoteVirtualModuleMock: vi.fn(),
  remoteModulePath: '/virtual/scheduler.js',
}));

vi.mock('../../utils/packageUtils', () => ({
  getInstalledPackageEntry: getInstalledPackageEntryMock,
  getIsRolldown: getIsRolldownMock,
}));

vi.mock('../../utils/devRemoteVersionState', () => ({
  getDevRemoteVersion: getDevRemoteVersionMock,
}));

vi.mock('../../virtualModules', () => ({
  addUsedRemote: addUsedRemoteMock,
  getRemoteVirtualModule: getRemoteVirtualModuleMock,
}));

import pluginProxyRemotes from '../pluginProxyRemotes';

describe('pluginProxyRemotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDevRemoteVersionMock.mockReturnValue(undefined);
    getRemoteVirtualModuleMock.mockReturnValue({
      getPath: () => remoteModulePath,
    });
  });

  function createSchedulerPlugin(configOverrides: Record<string, unknown> = {}) {
    const plugin = pluginProxyRemotes({
      remotes: {
        scheduler: {
          name: 'scheduler',
        },
      },
    } as any);
    const config = {
      resolve: {
        alias: [],
      },
      ...configOverrides,
    } as any;

    (plugin as any).config.call({} as any, config, { command: 'serve' });
    return { config, plugin };
  }

  it('does not register deprecated alias custom resolvers', () => {
    const { config } = createSchedulerPlugin();

    expect(config.resolve.alias).toEqual([]);
  });

  it('still proxies bare remote ids from app importers via resolveId', () => {
    const { plugin } = createSchedulerPlugin();
    const result = (plugin as any).resolveId.call(
      { meta: { rolldownVersion: '1.0.0' } } as any,
      'scheduler',
      '/repo/src/App.tsx'
    );

    expect(result).toBe(remoteModulePath);
    expect(getRemoteVirtualModuleMock).toHaveBeenCalledWith('scheduler', 'serve', true);
    expect(addUsedRemoteMock).toHaveBeenCalledWith('scheduler', 'scheduler');
  });

  it('still proxies bare remote ids from node_modules importers when no package collides', () => {
    const { plugin } = createSchedulerPlugin();
    const result = (plugin as any).resolveId.call(
      { meta: { rolldownVersion: '1.0.0' } } as any,
      'scheduler',
      '/repo/node_modules/.vite/deps/react-dom.js'
    );

    expect(result).toBe(remoteModulePath);
    expect(getRemoteVirtualModuleMock).toHaveBeenCalledWith('scheduler', 'serve', true);
    expect(addUsedRemoteMock).toHaveBeenCalledWith('scheduler', 'scheduler');
  });

  it('resolves colliding installed packages for bare ids in node_modules importers', () => {
    getInstalledPackageEntryMock.mockReturnValue('/repo/node_modules/.pnpm/scheduler/index.js');
    const { plugin } = createSchedulerPlugin({ root: '/repo' });
    const result = (plugin as any).resolveId.call(
      { meta: { rolldownVersion: '1.0.0' } } as any,
      'scheduler',
      '/repo/node_modules/.vite/deps/react-dom.js'
    );

    expect(result).toBe('/repo/node_modules/.pnpm/scheduler/index.js');
    expect(getRemoteVirtualModuleMock).not.toHaveBeenCalled();
    expect(addUsedRemoteMock).not.toHaveBeenCalled();
  });

  it('still proxies remote subpaths from node_modules importers', () => {
    const { plugin } = createSchedulerPlugin();
    const result = (plugin as any).resolveId.call(
      { meta: { rolldownVersion: '1.0.0' } } as any,
      'scheduler/SchedulePanel',
      '/repo/node_modules/some-package/index.js'
    );

    expect(result).toBe(remoteModulePath);
    expect(getRemoteVirtualModuleMock).toHaveBeenCalledWith(
      'scheduler/SchedulePanel',
      'serve',
      true
    );
    expect(addUsedRemoteMock).toHaveBeenCalledWith('scheduler', 'scheduler/SchedulePanel');
  });

  it('appends the latest dev remote version query when present', () => {
    getDevRemoteVersionMock.mockReturnValue(123456789);
    const { plugin } = createSchedulerPlugin();
    const result = (plugin as any).resolveId.call(
      { meta: { rolldownVersion: '1.0.0' } } as any,
      'scheduler/SchedulePanel',
      '/repo/src/App.tsx'
    );

    expect(result).toBe('/virtual/scheduler.js?t=123456789');
    expect(getDevRemoteVersionMock).toHaveBeenCalledWith(
      undefined,
      'scheduler/SchedulePanel'
    );
    expect(getRemoteVirtualModuleMock).toHaveBeenCalledWith(
      'scheduler/SchedulePanel',
      'serve',
      true
    );
    expect(addUsedRemoteMock).toHaveBeenCalledWith('scheduler', 'scheduler/SchedulePanel');
  });
});
