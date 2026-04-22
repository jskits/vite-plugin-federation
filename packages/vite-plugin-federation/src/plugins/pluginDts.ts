import { normalizeOptions, type moduleFederationPlugin } from '@module-federation/sdk';
import {
  consumeTypesAPI,
  generateTypesAPI,
  isTSProject,
  normalizeConsumeTypesOptions,
  normalizeDtsOptions,
  normalizeGenerateTypesOptions,
} from '@module-federation/dts-plugin';
import { rpc, type DTSManagerOptions } from '@module-federation/dts-plugin/core';
import { createRequire } from 'node:module';
import * as path from 'pathe';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';
import { createModuleFederationError, mfError } from '../utils/logger';

type DevOptions = {
  disableLiveReload?: boolean;
  disableHotTypesReload?: boolean;
  disableDynamicRemoteTypeHints?: boolean;
};

const DEFAULT_DEV_OPTIONS: Required<DevOptions> = {
  disableLiveReload: true,
  disableHotTypesReload: false,
  disableDynamicRemoteTypeHints: false,
};

const DYNAMIC_HINTS_PLUGIN = '@module-federation/dts-plugin/dynamic-remote-type-hints-plugin';

const getIPv4 = () => process.env['FEDERATION_IPV4'] || '127.0.0.1';

type DevWorkerOptions = DTSManagerOptions & {
  name: string;
  disableLiveReload?: boolean;
  disableHotTypesReload?: boolean;
};

type RemoteTypeUrls = moduleFederationPlugin.RemoteTypeUrls;
type RemoteTypeUrlFactory = () => Promise<RemoteTypeUrls>;
type FetchResponseLike = {
  ok: boolean;
  json: () => Promise<unknown>;
};
type FetchLike = (url: string) => Promise<FetchResponseLike>;
type HostWithRemoteTypeUrls = {
  remoteTypeUrls?: RemoteTypeUrls | RemoteTypeUrlFactory;
};

const forkDevWorkerPath = (() => {
  const currentPackageRequire = createRequire(import.meta.url);
  return currentPackageRequire.resolve('@module-federation/dts-plugin/dist/fork-dev-worker.js');
})();

class DevWorker {
  private readonly worker = rpc.createRpcWorker(forkDevWorkerPath, {}, undefined, false);

  constructor(options: DevWorkerOptions) {
    this.worker.connect(options);
  }

  update(): void {
    this.worker.process?.send?.({
      type: rpc.RpcGMCallTypes.CALL,
      id: this.worker.id,
      args: [undefined, 'update'],
    });
  }

  exit(): void {
    this.worker.terminate();
  }
}

const normalizeDevOptions = (dev: NormalizedModuleFederationOptions['dev']): DevOptions | false => {
  if (dev === false) {
    return false;
  }
  if (dev === true || typeof dev === 'undefined') {
    return { ...DEFAULT_DEV_OPTIONS };
  }
  return { ...DEFAULT_DEV_OPTIONS, ...dev };
};

const buildDtsModuleFederationConfig = (
  options: NormalizedModuleFederationOptions,
): moduleFederationPlugin.ModuleFederationPluginOptions => {
  const exposes: Record<string, string> = {};
  Object.entries(options.exposes).forEach(([key, value]) => {
    if (typeof value === 'string') {
      exposes[key] = value;
      return;
    }
    const importValue = Array.isArray(value.import) ? value.import[0] : value.import;
    if (importValue) {
      exposes[key] = importValue;
    }
  });

  const remotes: Record<string, string> = {};
  Object.entries(options.remotes).forEach(([key, remote]) => {
    if (typeof remote === 'string') {
      remotes[key] = remote;
      return;
    }
    if (!remote.entry) {
      return;
    }
    const entryLooksLikeUrl =
      remote.entryGlobalName?.startsWith('http') || remote.entryGlobalName?.includes('.json');
    const entryGlobalName = entryLooksLikeUrl
      ? remote.name || key
      : remote.entryGlobalName || remote.name || key;
    remotes[key] = `${entryGlobalName}@${remote.entry}`;
  });

  return {
    ...(options as unknown as moduleFederationPlugin.ModuleFederationPluginOptions),
    exposes,
    remotes,
  };
};

const resolveOutputDir = (config: ResolvedConfig): string => {
  const { outDir } = config.build;
  if (path.isAbsolute(outDir)) {
    return path.relative(config.root, outDir);
  }
  return outDir;
};

const ensureRuntimePlugin = (
  options: NormalizedModuleFederationOptions,
  pluginId: string,
): void => {
  const hasPlugin = options.runtimePlugins.some((plugin) => {
    if (typeof plugin === 'string') {
      return plugin === pluginId;
    }
    return plugin[0] === pluginId;
  });

  if (!hasPlugin) {
    options.runtimePlugins.push(pluginId);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getFetch = (fetchImpl?: FetchLike): FetchLike | undefined => {
  if (fetchImpl) {
    return fetchImpl;
  }
  if (typeof globalThis.fetch !== 'function') {
    return undefined;
  }
  return globalThis.fetch.bind(globalThis) as unknown as FetchLike;
};

const getManifestRemoteUrl = (entry: string): string | undefined => {
  try {
    const url = new URL(entry);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return undefined;
    }
    if (!url.pathname.endsWith('.json')) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const resolveTypeArtifactUrl = (
  manifestUrl: string,
  typePath: string | undefined,
  fileName: string,
): string => {
  const baseUrl = new URL('.', manifestUrl);
  const normalizedTypePath = typePath ? typePath.replace(/\/?$/, '/') : '';
  return new URL(`${normalizedTypePath}${fileName}`, baseUrl).toString();
};

const readManifestTypes = async (
  manifestUrl: string,
  fetchImpl: FetchLike,
): Promise<{ name: string; api: string; path?: string } | undefined> => {
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    return undefined;
  }

  const manifest = await response.json();
  if (!isRecord(manifest) || !isRecord(manifest.metaData) || !isRecord(manifest.metaData.types)) {
    return undefined;
  }

  const types = manifest.metaData.types;
  if (typeof types.name !== 'string' || typeof types.api !== 'string') {
    return undefined;
  }

  return {
    name: types.name,
    api: types.api,
    path: typeof types.path === 'string' ? types.path : undefined,
  };
};

export const resolveManifestRemoteTypeUrls = async (
  options: NormalizedModuleFederationOptions,
  fetchImpl?: FetchLike,
): Promise<RemoteTypeUrls> => {
  const fetcher = getFetch(fetchImpl);
  if (!fetcher) {
    return {};
  }

  const entries = await Promise.all(
    Object.entries(options.remotes).map(async ([remoteName, remote]) => {
      const manifestUrl = getManifestRemoteUrl(remote.entry);
      if (!manifestUrl) {
        return undefined;
      }

      try {
        const types = await readManifestTypes(manifestUrl, fetcher);
        if (!types) {
          return undefined;
        }

        return [
          remoteName,
          {
            alias: remoteName,
            api: resolveTypeArtifactUrl(manifestUrl, types.path, types.api),
            zip: resolveTypeArtifactUrl(manifestUrl, types.path, types.name),
          },
        ] as const;
      } catch {
        return undefined;
      }
    }),
  );

  return Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => !!entry));
};

export const applyManifestRemoteTypeUrls = async (
  host: HostWithRemoteTypeUrls,
  options: NormalizedModuleFederationOptions,
  fetchImpl?: FetchLike,
): Promise<void> => {
  const currentRemoteTypeUrls = host.remoteTypeUrls;

  if (typeof currentRemoteTypeUrls === 'function') {
    host.remoteTypeUrls = async () => ({
      ...(await resolveManifestRemoteTypeUrls(options, fetchImpl)),
      ...(await currentRemoteTypeUrls()),
    });
    return;
  }

  const manifestRemoteTypeUrls = await resolveManifestRemoteTypeUrls(options, fetchImpl);
  if (Object.keys(manifestRemoteTypeUrls).length === 0 && !currentRemoteTypeUrls) {
    return;
  }

  host.remoteTypeUrls = {
    ...manifestRemoteTypeUrls,
    ...(currentRemoteTypeUrls || {}),
  };
};

const normalizeDevDtsOptions = (
  dts: NormalizedModuleFederationOptions['dts'],
  context: string,
): moduleFederationPlugin.PluginDtsOptions | false => {
  const defaultGenerateTypes: moduleFederationPlugin.DtsRemoteOptions = {
    compileInChildProcess: true,
  };
  const defaultConsumeTypes: moduleFederationPlugin.DtsHostOptions = {
    consumeAPITypes: true,
  };

  return normalizeOptions<moduleFederationPlugin.PluginDtsOptions>(
    isTSProject(dts as moduleFederationPlugin.ModuleFederationPluginOptions['dts'], context),
    {
      generateTypes: defaultGenerateTypes,
      consumeTypes: defaultConsumeTypes,
      extraOptions: {},
      displayErrorInTerminal:
        typeof dts === 'object' && dts
          ? (dts as moduleFederationPlugin.PluginDtsOptions).displayErrorInTerminal
          : undefined,
    },
    'mfOptions.dts',
  )(dts as moduleFederationPlugin.PluginDtsOptions | boolean | undefined);
};

const logDtsError = (error: unknown, dtsOptions?: NormalizedModuleFederationOptions['dts']) => {
  if (dtsOptions === false) {
    return;
  }
  if (typeof dtsOptions === 'object' && dtsOptions && dtsOptions.displayErrorInTerminal === false) {
    return;
  }
  mfError(error);
};

export const shouldAbortDtsBuildError = (
  dtsOptions: moduleFederationPlugin.PluginDtsOptions | false,
  phase: 'consumeTypes' | 'generateTypes',
): boolean => {
  if (typeof dtsOptions !== 'object' || !dtsOptions) {
    return false;
  }

  const phaseOptions = dtsOptions[phase];
  return typeof phaseOptions === 'object' && phaseOptions?.abortOnError === true;
};

const handleBuildDtsError = (
  error: unknown,
  dtsOptions: moduleFederationPlugin.PluginDtsOptions | false,
  phase: 'consumeTypes' | 'generateTypes',
): void => {
  logDtsError(error, dtsOptions);
  if (shouldAbortDtsBuildError(dtsOptions, phase)) {
    throw error;
  }
};

export default function pluginDts(options: NormalizedModuleFederationOptions): Plugin[] {
  if (options.dts === false) {
    return [];
  }

  const dtsModuleFederationConfig = buildDtsModuleFederationConfig(options);
  let resolvedConfig: ResolvedConfig | undefined;
  let devWorker: DevWorker | undefined;
  let normalizedDevOptions: DevOptions | false | undefined;
  let hasGeneratedBundle = false;

  const devPlugin: Plugin = {
    name: 'module-federation-dts-dev',
    apply: 'serve',
    config(config) {
      normalizedDevOptions = normalizeDevOptions(options.dev);
      if (!normalizedDevOptions) {
        return;
      }

      if (normalizedDevOptions.disableDynamicRemoteTypeHints) {
        return;
      }

      ensureRuntimePlugin(options, DYNAMIC_HINTS_PLUGIN);
      const define = config.define ? { ...config.define } : {};
      if (!('FEDERATION_IPV4' in define)) {
        define.FEDERATION_IPV4 = JSON.stringify(getIPv4());
      }
      config.define = define;
    },
    configResolved(config) {
      resolvedConfig = config;
    },
    configureServer(server: ViteDevServer) {
      if (!normalizedDevOptions || !resolvedConfig) {
        return;
      }
      const devOptions = normalizedDevOptions;

      if (
        devOptions.disableDynamicRemoteTypeHints &&
        devOptions.disableHotTypesReload &&
        devOptions.disableLiveReload
      ) {
        return;
      }

      if (!options.name) {
        throw createModuleFederationError(
          'MFV-001',
          'name is required if you want to enable dev server!',
        );
      }

      const outputDir = resolveOutputDir(resolvedConfig);
      const normalizedDtsOptions = normalizeDevDtsOptions(options.dts, resolvedConfig.root);

      if (typeof normalizedDtsOptions !== 'object') {
        return;
      }

      const normalizedGenerateTypes = normalizeOptions<moduleFederationPlugin.DtsRemoteOptions>(
        Boolean(normalizedDtsOptions),
        { compileInChildProcess: true },
        'mfOptions.dts.generateTypes',
      )(normalizedDtsOptions.generateTypes);

      const remote =
        normalizedGenerateTypes === false
          ? undefined
          : {
              implementation: normalizedDtsOptions.implementation,
              context: resolvedConfig.root,
              outputDir,
              moduleFederationConfig: {
                ...dtsModuleFederationConfig,
              },
              hostRemoteTypesFolder: normalizedGenerateTypes.typesFolder || '@mf-types',
              ...normalizedGenerateTypes,
              typesFolder: '.dev-server',
            };

      if (
        remote &&
        !remote.tsConfigPath &&
        typeof normalizedDtsOptions === 'object' &&
        normalizedDtsOptions.tsConfigPath
      ) {
        remote.tsConfigPath = normalizedDtsOptions.tsConfigPath;
      }

      const normalizedConsumeTypes = normalizeOptions<moduleFederationPlugin.DtsHostOptions>(
        Boolean(normalizedDtsOptions),
        { consumeAPITypes: true },
        'mfOptions.dts.consumeTypes',
      )(normalizedDtsOptions.consumeTypes);

      const host =
        normalizedConsumeTypes === false
          ? undefined
          : {
              implementation: normalizedDtsOptions.implementation,
              context: resolvedConfig.root,
              moduleFederationConfig: dtsModuleFederationConfig,
              typesFolder: normalizedConsumeTypes.typesFolder || '@mf-types',
              abortOnError: false,
              ...normalizedConsumeTypes,
            };

      const extraOptions = normalizedDtsOptions.extraOptions || {};

      if (!remote && !host && devOptions.disableLiveReload) {
        return;
      }

      const startDevWorker = async () => {
        let remoteTypeUrls: moduleFederationPlugin.RemoteTypeUrls | undefined;
        if (host) {
          await applyManifestRemoteTypeUrls(host, options);
          remoteTypeUrls = await new Promise((resolve) => {
            consumeTypesAPI(
              {
                host,
                extraOptions,
                displayErrorInTerminal: normalizedDtsOptions.displayErrorInTerminal,
              },
              resolve,
            );
          });
        }

        devWorker = new DevWorker({
          name: options.name,
          remote,
          host: host
            ? {
                ...host,
                remoteTypeUrls,
              }
            : undefined,
          extraOptions,
          disableLiveReload: devOptions.disableLiveReload,
          disableHotTypesReload: devOptions.disableHotTypesReload,
        });

        const update = () => devWorker?.update();
        server.watcher.on('change', update);
        server.watcher.on('add', update);
        server.watcher.on('unlink', update);

        server.httpServer?.once('close', () => {
          devWorker?.exit();
          server.watcher.off('change', update);
          server.watcher.off('add', update);
          server.watcher.off('unlink', update);
        });
      };

      startDevWorker().catch((error) => {
        logDtsError(error, normalizedDtsOptions);
      });
    },
  };

  const buildPlugin: Plugin = {
    name: 'module-federation-dts-build',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    async generateBundle() {
      if (hasGeneratedBundle) {
        return;
      }
      hasGeneratedBundle = true;
      if (!resolvedConfig) {
        return;
      }
      let normalizedDtsOptions: moduleFederationPlugin.PluginDtsOptions | false;
      try {
        normalizedDtsOptions = normalizeDtsOptions(dtsModuleFederationConfig, resolvedConfig.root);
      } catch (error) {
        logDtsError(error, options.dts);
        return;
      }

      if (typeof normalizedDtsOptions !== 'object') {
        return;
      }

      const context = resolvedConfig.root;
      const outputDir = resolveOutputDir(resolvedConfig);

      let consumeOptions: ReturnType<typeof normalizeConsumeTypesOptions> | undefined;
      try {
        consumeOptions = normalizeConsumeTypesOptions({
          context,
          dtsOptions: normalizedDtsOptions,
          pluginOptions: dtsModuleFederationConfig,
        });
      } catch (error) {
        handleBuildDtsError(error, normalizedDtsOptions, 'consumeTypes');
        return;
      }

      if (consumeOptions?.host?.typesOnBuild) {
        try {
          await applyManifestRemoteTypeUrls(consumeOptions.host, options);
          await consumeTypesAPI(consumeOptions);
        } catch (error) {
          handleBuildDtsError(error, normalizedDtsOptions, 'consumeTypes');
        }
      }

      let generateOptions: ReturnType<typeof normalizeGenerateTypesOptions> | undefined;
      try {
        generateOptions = normalizeGenerateTypesOptions({
          context,
          outputDir,
          dtsOptions: normalizedDtsOptions,
          pluginOptions: dtsModuleFederationConfig,
        });
      } catch (error) {
        handleBuildDtsError(error, normalizedDtsOptions, 'generateTypes');
        return;
      }

      if (!generateOptions) {
        return;
      }

      try {
        await generateTypesAPI({ dtsManagerOptions: generateOptions });
      } catch (error) {
        handleBuildDtsError(error, normalizedDtsOptions, 'generateTypes');
      }
    },
  };

  return [devPlugin, buildPlugin];
}
