import * as path from 'pathe';
import type { Plugin } from 'vite';
import {
  getNormalizeModuleFederationOptions,
  getNormalizeShareItem,
} from '../utils/normalizeModuleFederationOptions';
import {
  FEDERATION_DEBUG_SCHEMA_VERSION,
  FEDERATION_MANIFEST_SCHEMA_VERSION,
  FEDERATION_STATS_SCHEMA_VERSION,
} from '../utils/manifestProtocol';
import { getInstalledPackageEntry } from '../utils/packageUtils';
import { getUsedRemotesMap, getUsedShares, inspectSharedImportSource } from '../virtualModules';

import { findEntryFile, findRemoteEntryFile } from '../utils/bundleHelpers';
import { getSsrRemoteEntryFileName } from '../virtualModules';
import type { PreloadMap } from '../utils/cssModuleHelpers';
import {
  buildFileToShareKeyMap,
  collectCssAssets,
  createEmptyAssetMap,
  deduplicateAssets,
  JS_EXTENSIONS,
  processModuleAssets,
  trackAsset,
} from '../utils/cssModuleHelpers';
import { resolvePublicPath } from '../utils/publicPath';

declare const __VITE_PLUGIN_FEDERATION_VERSION__: string | undefined;

const PLUGIN_VERSION =
  typeof __VITE_PLUGIN_FEDERATION_VERSION__ === 'string'
    ? __VITE_PLUGIN_FEDERATION_VERSION__
    : '0.0.0';

function getFirstEnvValue(keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function getBuildInfo(name: string) {
  return {
    buildVersion:
      getFirstEnvValue([
        'VITE_PLUGIN_FEDERATION_BUILD_VERSION',
        'MF_BUILD_VERSION',
        'GITHUB_SHA',
        'VERCEL_GIT_COMMIT_SHA',
      ]) || 'local',
    buildName:
      getFirstEnvValue([
        'VITE_PLUGIN_FEDERATION_BUILD_NAME',
        'MF_BUILD_NAME',
        'GITHUB_REF_NAME',
        'VERCEL_GIT_COMMIT_REF',
      ]) || name,
  };
}

const Manifest = (): Plugin[] => {
  const mfOptions = getNormalizeModuleFederationOptions();
  const { name, filename, getPublicPath, manifest: manifestOptions, varFilename } = mfOptions;

  const mfManifestName =
    manifestOptions === true
      ? 'mf-manifest.json'
      : typeof manifestOptions === 'object'
        ? path.join(
            manifestOptions?.filePath || '',
            manifestOptions?.fileName || 'mf-manifest.json',
          )
        : undefined;

  const mfManifestStatsName = mfManifestName ? getStatsFileName(mfManifestName) : undefined;
  const mfDebugName = mfManifestName ? getDebugFileName(mfManifestName) : undefined;
  const isConsumerProject = Object.keys(mfOptions.exposes).length === 0;
  let disableAssetsAnalyze = false;

  const getDefaultDisableAssetsAnalyze = (command: string | undefined) =>
    command === 'serve' &&
    isConsumerProject &&
    (typeof manifestOptions !== 'object' ||
      !Object.prototype.hasOwnProperty.call(manifestOptions, 'disableAssetsAnalyze'));

  const getConfiguredDisableAssetsAnalyze = (command: string | undefined) => {
    if (typeof manifestOptions === 'object' && manifestOptions !== null) {
      if (Object.prototype.hasOwnProperty.call(manifestOptions, 'disableAssetsAnalyze')) {
        return manifestOptions.disableAssetsAnalyze === true;
      }
    }
    return getDefaultDisableAssetsAnalyze(command);
  };

  let root: string;
  let remoteEntryFile: string;
  let ssrRemoteEntryFile: string;
  let publicPath: string;
  let _command: string;
  let _originalConfigBase: string | undefined;
  let viteConfig: any;

  /**
   * Adds global CSS assets to all module exports
   * @param filesMap - The preload map to update
   * @param cssAssets - Set of CSS asset filenames to add
   */
  const addCssAssetsToAllExports = (filesMap: PreloadMap, cssAssets: Set<string>) => {
    Object.keys(filesMap).forEach((key) => {
      cssAssets.forEach((cssAsset) => {
        trackAsset(filesMap, key, cssAsset, false, 'css');
      });
    });
  };

  const getDevRequestPublicPath = (req: {
    headers?: Record<string, string | string[] | undefined>;
  }) => {
    if (mfOptions.publicPath === 'auto') {
      return 'auto';
    }

    const forwardedProto = req.headers?.['x-forwarded-proto'];
    const protocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto || (viteConfig.server?.https ? 'https' : 'http');
    const hostHeader = req.headers?.host;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    if (!host) {
      return publicPath;
    }

    return `${protocol}://${host}${viteConfig.base.replace(/\/?$/, '/')}`;
  };

  const getEffectiveRemoteEntryFile = () => remoteEntryFile || filename;
  const getEffectiveSsrRemoteEntryFile = () =>
    ssrRemoteEntryFile ||
    (Object.keys(mfOptions.exposes).length > 0 ? getSsrRemoteEntryFileName(filename) : filename);

  return [
    {
      name: 'module-federation-manifest',
      apply: 'serve',
      /**
       * Stores resolved Vite config for later use
       */
      /**
       * Finalizes configuration after all plugins are resolved
       * @param config - Fully resolved Vite config
       */
      configResolved(config) {
        viteConfig = config;
      },
      /**
       * Configures dev server middleware to handle manifest requests
       * @param server - Vite dev server instance
       */
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!mfManifestName) {
            next();
            return;
          }
          if (
            req.url?.replace(/\?.*/, '') === (viteConfig.base + mfManifestName).replace(/^\/?/, '/')
          ) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(
              JSON.stringify({
                ...generateMFManifest({}, disableAssetsAnalyze),
                id: name,
                name: name,
                metaData: {
                  name: name,
                  type: 'app',
                  buildInfo: getBuildInfo(name),
                  remoteEntry: {
                    name: getEffectiveRemoteEntryFile(),
                    path: '',
                    type: 'module',
                  },
                  ssrRemoteEntry: {
                    name: getEffectiveSsrRemoteEntryFile(),
                    path: '',
                    type: 'module',
                  },
                  varRemoteEntry: varFilename
                    ? {
                        name: varFilename,
                        path: '',
                        type: 'var',
                      }
                    : undefined,
                  types: getTypesMetadata(mfOptions),
                  globalName: name,
                  pluginVersion: PLUGIN_VERSION,
                  publicPath: getDevRequestPublicPath(req),
                },
              }),
            );
          } else if (
            mfDebugName &&
            req.url?.replace(/\?.*/, '') === (viteConfig.base + mfDebugName).replace(/^\/?/, '/')
          ) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify(generateMFDebug({}, {}, disableAssetsAnalyze)));
          } else {
            next();
          }
        });
      },
    },
    {
      name: 'module-federation-manifest',
      enforce: 'post',
      /**
       * Initial plugin configuration
       * @param config - Vite config object
       * @param command - Current Vite command (serve/build)
       */
      config(config, { command }) {
        _command = command;
        if (!config.build) config.build = {};
        if (!config.build.manifest) {
          config.build.manifest = config.build.manifest || !!mfManifestName;
        }
        disableAssetsAnalyze = getConfiguredDisableAssetsAnalyze(command);
        _originalConfigBase = config.base;
      },
      configResolved(config) {
        root = config.root;
        let base = config.base;
        if (_command === 'serve') {
          base = (config.server.origin || '') + config.base;
        }
        // resolvePublicPath treats "auto" as unset to avoid broken concatenation
        // in dev code generation (e.g. "auto" + "remoteEntry.js" → "autoremoteEntry.js").
        // For the manifest, "auto" is a valid sentinel the MF runtime understands,
        // so we preserve it here before falling back to the resolver.
        publicPath =
          mfOptions.publicPath === 'auto'
            ? 'auto'
            : resolvePublicPath(mfOptions, base, _originalConfigBase);
      },
      /**
       * Generates the module federation manifest file
       * @param options - Rollup output options
       * @param bundle - Generated bundle assets
       */
      async generateBundle(options, bundle) {
        if (!mfManifestName) return;

        let filesMap: PreloadMap = {};

        const foundRemoteEntryFile = findRemoteEntryFile(mfOptions.filename, bundle);
        const foundSsrRemoteEntryFile = findEntryFile(
          getSsrRemoteEntryFileName(mfOptions.filename),
          bundle,
          'ssrRemoteEntry',
        );

        // First pass: Find remoteEntry file
        if (foundRemoteEntryFile) {
          remoteEntryFile = foundRemoteEntryFile;
        }
        if (foundSsrRemoteEntryFile) {
          ssrRemoteEntryFile = foundSsrRemoteEntryFile;
        }

        // Second pass: Collect all CSS assets
        const allCssAssets =
          mfOptions.bundleAllCSS && !disableAssetsAnalyze
            ? collectCssAssets(bundle)
            : new Set<string>();

        if (!disableAssetsAnalyze) {
          const exposesModules = Object.keys(mfOptions.exposes).map(
            (item) => mfOptions.exposes[item].import,
          );

          // Process exposed modules
          processModuleAssets(bundle, filesMap, (modulePath) => {
            const absoluteModulePath = path.resolve(root, modulePath);
            return exposesModules.find((exposeModule) => {
              const exposePath = path.resolve(root, exposeModule);

              // First try exact path match
              if (absoluteModulePath === exposePath) {
                return true;
              }

              // Then try path match without known extensions
              const getPathWithoutKnownExt = (filePath: string) => {
                const ext = path.extname(filePath);
                return JS_EXTENSIONS.includes(ext as any)
                  ? path.join(path.dirname(filePath), path.basename(filePath, ext))
                  : filePath;
              };
              const modulePathNoExt = getPathWithoutKnownExt(absoluteModulePath);
              const exposePathNoExt = getPathWithoutKnownExt(exposePath);
              return modulePathNoExt === exposePathNoExt;
            });
          });

          // Process shared modules
          const fileToShareKey = await buildFileToShareKeyMap(
            getUsedShares(),
            this.resolve.bind(this),
          );
          processModuleAssets(bundle, filesMap, (modulePath) => fileToShareKey.get(modulePath));

          // Add all CSS assets to every export if bundleAllCSS is enabled
          if (mfOptions.bundleAllCSS) {
            addCssAssetsToAllExports(filesMap, allCssAssets);
          }

          // Final deduplication of all assets
          filesMap = deduplicateAssets(filesMap);
        }

        this.emitFile({
          type: 'asset',
          fileName: mfManifestName,
          source: JSON.stringify(generateMFManifest(filesMap, disableAssetsAnalyze)),
        });

        if (mfManifestStatsName) {
          this.emitFile({
            type: 'asset',
            fileName: mfManifestStatsName,
            source: JSON.stringify(generateMFStats(filesMap, bundle, disableAssetsAnalyze)),
          });
        }

        if (mfDebugName) {
          this.emitFile({
            type: 'asset',
            fileName: mfDebugName,
            source: JSON.stringify(generateMFDebug(filesMap, bundle, disableAssetsAnalyze)),
          });
        }
      },
    },
  ];

  /**
   * Generates the final manifest JSON structure
   * @param preloadMap - Map of module assets to include
   * @returns Complete manifest object
   */
  function generateMFManifest(preloadMap: PreloadMap, disableAssetsAnalyze = false) {
    const options = getNormalizeModuleFederationOptions();
    const { name, varFilename } = options;
    const remoteEntry = {
      name: getEffectiveRemoteEntryFile(),
      path: '',
      type: 'module',
    };
    const ssrRemoteEntry = {
      name: getEffectiveSsrRemoteEntryFile(),
      path: '',
      type: 'module',
    };

    const varRemoteEntry = varFilename
      ? {
          name: varFilename,
          path: '',
          type: 'module',
        }
      : undefined;

    // Process remotes
    const remotes = Array.from(Object.entries(getUsedRemotesMap())).flatMap(
      ([remoteKey, modules]) =>
        Array.from(modules).map((moduleKey) => ({
          federationContainerName: options.remotes[remoteKey].entry,
          moduleName: moduleKey.replace(remoteKey, '').replace('/', ''),
          alias: remoteKey,
          entry: '*',
        })),
    );

    // Process shared dependencies
    const shared = Array.from(getUsedShares())
      .map((shareKey) => {
        const shareItem = getNormalizeShareItem(shareKey);
        const assets = preloadMap[shareKey] || createEmptyAssetMap();

        return {
          id: `${name}:${shareKey}`,
          name: shareKey,
          version: shareItem.version,
          singleton: shareItem.shareConfig.singleton,
          requiredVersion: shareItem.shareConfig.requiredVersion,
          assets: {
            js: {
              async: assets.js.async,
              sync: assets.js.sync,
            },
            css: {
              async: assets.css.async,
              sync: assets.css.sync,
            },
          },
        };
      })
      .filter(Boolean);

    // Process exposed modules
    const exposes = Object.entries(options.exposes)
      .map(([key, value]) => {
        const formatKey = key.replace('./', '');
        const sourceFile = value.import;
        const assets = preloadMap[sourceFile] || createEmptyAssetMap();

        return {
          id: `${name}:${formatKey}`,
          name: formatKey,
          css: {
            mode: getExposeCssMode(value),
          },
          assets: {
            js: {
              async: assets.js.async,
              sync: assets.js.sync,
            },
            css: {
              async: assets.css.async,
              sync: assets.css.sync,
            },
          },
          path: key,
        };
      })
      .filter(Boolean);

    return {
      schemaVersion: FEDERATION_MANIFEST_SCHEMA_VERSION,
      id: name,
      name,
      metaData: {
        name,
        type: 'app',
        buildInfo: getBuildInfo(name),
        remoteEntry,
        ssrRemoteEntry,
        varRemoteEntry,
        types: getTypesMetadata(options),
        globalName: name,
        pluginVersion: PLUGIN_VERSION,
        ...(getPublicPath ? { getPublicPath } : { publicPath }),
      },
      ...(disableAssetsAnalyze ? {} : { shared }),
      remotes,
      ...(disableAssetsAnalyze ? {} : { exposes }),
    };
  }

  function generateMFStats(
    preloadMap: PreloadMap,
    bundle: Record<string, { [key: string]: any }>,
    disableAssetsAnalyze = false,
  ) {
    const baseManifest = generateMFManifest(preloadMap, disableAssetsAnalyze);
    const bundleSummary = Object.entries(bundle).map(([fileName, chunkOrAsset]) => ({
      fileName,
      type: chunkOrAsset.type,
      isEntry: chunkOrAsset.isEntry || false,
      size:
        typeof chunkOrAsset.code === 'string'
          ? chunkOrAsset.code.length
          : chunkOrAsset.source?.length || chunkOrAsset.source?.byteLength || undefined,
    }));

    return {
      ...baseManifest,
      schemaVersion: FEDERATION_STATS_SCHEMA_VERSION,
      buildOutput: bundleSummary,
      diagnostics: generateBuildDiagnostics(bundle),
      ...(disableAssetsAnalyze ? {} : { assetAnalysis: preloadMap }),
    };
  }

  function generateMFDebug(
    preloadMap: PreloadMap,
    bundle: Record<string, { [key: string]: any }> = {},
    disableAssetsAnalyze = false,
  ) {
    const options = getNormalizeModuleFederationOptions();

    return {
      schemaVersion: FEDERATION_DEBUG_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      manifestFile: mfManifestName,
      statsFile: mfManifestStatsName,
      metaData: {
        pluginName: 'vite-plugin-federation',
        pluginVersion: PLUGIN_VERSION,
      },
      options: {
        bundleAllCSS: options.bundleAllCSS,
        compatibility: options.compat,
        filename: options.filename,
        publicPath: publicPath || options.publicPath,
        shareStrategy: options.shareStrategy,
      },
      capabilities: {
        debugArtifacts: Boolean(mfDebugName),
        manifest: Boolean(mfManifestName),
        remoteHmr: typeof options.dev === 'object' && options.dev?.remoteHmr === true,
        ssr: Boolean(ssrRemoteEntryFile || remoteEntryFile),
        stats: Boolean(mfManifestStatsName),
        types: options.dts !== false,
      },
      remotes: Object.entries(options.remotes).map(([alias, remote]) => ({
        alias,
        entry: remote.entry,
        entryGlobalName: remote.entryGlobalName,
        format: remote.format,
        from: remote.from,
        shareScope: remote.shareScope,
        type: remote.type,
      })),
      shared: Object.keys(options.shared).map((name) => {
        const share = getNormalizeShareItem(name);

        return {
          import: share.shareConfig.import,
          requiredVersion: share.shareConfig.requiredVersion,
          singleton: share.shareConfig.singleton,
          strictVersion: share.shareConfig.strictVersion || false,
          version: share.version,
          name,
        };
      }),
      exposes: Object.entries(options.exposes).map(([name, expose]) => ({
        css: expose.css,
        import: expose.import,
        name,
      })),
      diagnostics: generateBuildDiagnostics(bundle),
      snapshot: generateMFManifest(preloadMap, disableAssetsAnalyze),
    };
  }

  function generateBuildDiagnostics(bundle: Record<string, { [key: string]: any }>) {
    const options = getNormalizeModuleFederationOptions();
    const usedShares = getUsedShares();

    return {
      controlChunks: Object.entries(bundle)
        .filter(([fileName]) =>
          /(remoteEntry|localSharedImportMap|__loadShare__|hostInit|virtualExposes)/.test(fileName),
        )
        .map(([fileName, chunkOrAsset]) => ({
          fileName,
          isEntry: chunkOrAsset.isEntry || false,
          type: chunkOrAsset.type,
        })),
      remoteAliases: Object.entries(options.remotes).map(([alias, remote]) => {
        const installedPackageEntry = getInstalledPackageEntry(alias, { cwd: root });

        return {
          alias,
          collidesWithInstalledPackage: Boolean(installedPackageEntry),
          entry: remote.entry,
          installedPackageEntry: installedPackageEntry || null,
          remoteName: remote.name,
          shareScope: remote.shareScope,
          type: remote.type,
        };
      }),
      sharedResolution: Object.entries(options.shared).map(([shareKey]) => {
        const shareItem = getNormalizeShareItem(shareKey);
        const sharedImportInspection = inspectSharedImportSource(shareKey, shareItem);
        const concreteImportSource = sharedImportInspection.concreteImportSource;
        const isPrefixMatch = shareKey.endsWith('/');

        return {
          concreteImportSource: concreteImportSource || null,
          configuredImport:
            typeof shareItem.shareConfig.import === 'string' ? shareItem.shareConfig.import : null,
          fallbackMode:
            shareItem.shareConfig.import === false
              ? 'host-only'
              : concreteImportSource
                ? 'concrete-import'
                : sharedImportInspection.resolutionSource === 'project-root'
                  ? 'package-root'
                  : 'prebuild',
          importDisabled: shareItem.shareConfig.import === false,
          key: shareKey,
          matchType: isPrefixMatch ? 'prefix' : 'exact',
          requiredVersion: shareItem.shareConfig.requiredVersion,
          resolutionRoot: sharedImportInspection.resolutionRoot,
          resolutionSource: sharedImportInspection.resolutionSource,
          resolvedPackageEntry: sharedImportInspection.resolvedPackageEntry,
          singleton: shareItem.shareConfig.singleton,
          strictVersion: shareItem.shareConfig.strictVersion || false,
          used:
            usedShares.has(shareKey) ||
            (isPrefixMatch &&
              [...usedShares].some((usedShareKey) => usedShareKey.startsWith(shareKey))),
          version: shareItem.version || null,
        };
      }),
      ssr: {
        hasGetPublicPath: Boolean(getPublicPath),
        hasSsrRemoteEntry: Boolean(getEffectiveSsrRemoteEntryFile()),
        publicPath,
        remoteEntryFile: getEffectiveRemoteEntryFile() || null,
        ssrRemoteEntryFile: getEffectiveSsrRemoteEntryFile() || null,
      },
    };
  }
};

function getStatsFileName(manifestFileName: string) {
  const parsed = path.parse(manifestFileName);
  const fileExt = parsed.ext || '.json';
  const baseName = parsed.ext ? parsed.name : parsed.base;
  const baseWithoutManifestSuffix = baseName === 'mf-manifest' ? 'mf' : baseName;
  const fileName = `${baseWithoutManifestSuffix}-stats${fileExt}`;

  return parsed.dir ? path.join(parsed.dir, fileName) : fileName;
}

function getDebugFileName(manifestFileName: string) {
  const parsed = path.parse(manifestFileName);
  const fileName = 'mf-debug.json';

  return parsed.dir ? path.join(parsed.dir, fileName) : fileName;
}

function getExposeCssMode(expose: { css?: { inject?: string | boolean } }) {
  return expose.css?.inject || 'head';
}

function getTypesMetadata(options: {
  dts?: boolean | { generateTypes?: boolean | { typesFolder?: string } };
}) {
  if (options.dts === false) {
    return {
      path: '',
      name: '',
      api: '',
    };
  }

  let typesFolder = '@mf-types';
  if (
    typeof options.dts === 'object' &&
    options.dts &&
    typeof options.dts.generateTypes === 'object' &&
    options.dts.generateTypes?.typesFolder
  ) {
    typesFolder = options.dts.generateTypes.typesFolder;
  }

  return {
    path: '',
    name: `${typesFolder}.zip`,
    api: `${typesFolder}.d.ts`,
  };
}

export default Manifest;
