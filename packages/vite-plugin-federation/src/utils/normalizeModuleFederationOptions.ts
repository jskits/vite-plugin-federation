import type { SharedConfig, ShareStrategy } from '@module-federation/runtime/types';

export type RemoteEntryType =
  | 'var'
  | 'module'
  | 'assign'
  | 'assign-properties'
  | 'this'
  | 'window'
  | 'self'
  | 'global'
  | 'commonjs'
  | 'commonjs2'
  | 'commonjs-module'
  | 'commonjs-static'
  | 'amd'
  | 'amd-require'
  | 'umd'
  | 'umd2'
  | 'jsonp'
  | 'system'
  | string;

import * as fs from 'fs';
import { createRequire } from 'node:module';
import * as path from 'pathe';
import { createModuleFederationError, mfError, mfWarn } from './logger';
import { getInstalledPackageJson, removePathFromNpmPackage } from './packageUtils';

export type ExposeCssInjectMode = 'head' | 'manual' | 'none';

export interface ExposeCssOptions {
  inject?: boolean | ExposeCssInjectMode;
}

export interface ExposesItem {
  import: string;
  css?: ExposeCssOptions;
}
export interface NormalizedShared {
  [key: string]: ShareItem;
}
export interface CompatibilityOptions {
  originjs?: boolean;
  virtualFederationShim?: boolean;
}
export interface RemoteObjectConfig {
  type?: string;
  format?: string;
  from?: string;
  name: string;
  internalName?: string;
  entry: string;
  entryGlobalName?: string;
  shareScope?: string;
}

const INTERNAL_NAME_PREFIX = '__mfe_internal__';
const currentPackageRequire = createRequire(import.meta.url);
type ShareImportOption = string | false | undefined;
type ShareConfigWithImport = SharedConfig & {
  import?: ShareImportOption;
};

export function toInternalModuleFederationName(name: string) {
  return name.startsWith(INTERNAL_NAME_PREFIX) ? name : `${INTERNAL_NAME_PREFIX}${name}`;
}

function warnOnReservedInternalNamePrefix(name: string, kind: 'containerName' | 'remoteAlias') {
  if (!name.startsWith(INTERNAL_NAME_PREFIX)) return;
  mfWarn(
    `Reserved internal ${kind} prefix "${INTERNAL_NAME_PREFIX}" detected in public ${kind} "${name}". ` +
      'This prefix is reserved for internal module federation names and may cause conflicts.'
  );
}

function normalizeExposesItem(
  key: string,
  item: string | { import: string; css?: ExposeCssOptions; dontAppendStylesToHead?: boolean }
): ExposesItem {
  let importPath: string = '';
  let css: ExposeCssOptions | undefined;
  if (typeof item === 'string') {
    importPath = item;
  }
  if (typeof item === 'object') {
    importPath = item.import;
    const injectCss = normalizeExposeCssInject(
      item.dontAppendStylesToHead ? 'manual' : item.css?.inject
    );
    css =
      injectCss === undefined
        ? item.css
        : {
            ...(item.css || {}),
            inject: injectCss,
          };
  }
  return css
    ? {
        import: importPath,
        css,
      }
    : {
        import: importPath,
      };
}

function normalizeExposeCssInject(
  inject: ExposeCssOptions['inject'] | undefined
): ExposeCssInjectMode | undefined {
  if (inject === undefined) return undefined;
  if (inject === true) return 'head';
  if (inject === false) return 'manual';
  if (inject === 'head' || inject === 'manual' || inject === 'none') {
    return inject;
  }

  throw createModuleFederationError(
    'MFV-001',
    `Invalid expose css.inject value "${String(inject)}". Expected "head", "manual", or "none".`
  );
}

function normalizeExposes(
  exposes: Record<
    string,
    string | { import: string; css?: ExposeCssOptions; dontAppendStylesToHead?: boolean }
  > | undefined
): Record<string, ExposesItem> {
  if (!exposes) return {};
  const res: Record<string, ExposesItem> = {};
  Object.keys(exposes).forEach((key) => {
    res[key] = normalizeExposesItem(key, exposes[key]);
  });
  return res;
}

export function normalizeRemotes(
  remotes: Record<string, string | RemoteObjectConfig> | undefined
): Record<string, RemoteObjectConfig> {
  if (!remotes) return {};
  const result: Record<string, RemoteObjectConfig> = {};
  if (typeof remotes === 'object') {
    Object.keys(remotes).forEach((key) => {
      result[key] = normalizeRemoteItem(key, remotes[key]);
    });
  }
  return result;
}

function normalizeRemoteItem(key: string, remote: string | RemoteObjectConfig): RemoteObjectConfig {
  warnOnReservedInternalNamePrefix(key, 'remoteAlias');
  if (typeof remote === 'string') {
    // Scoped packages start with '@', so the name/entry separator is the
    // first '@' after the optional scope prefix, not the last '@' overall.
    const separatorIndex = remote.startsWith('@') ? remote.indexOf('@', 1) : remote.indexOf('@');
    let entryGlobalName: string;
    let entry: string;
    if (separatorIndex > 0) {
      entryGlobalName = remote.slice(0, separatorIndex);
      entry = remote.slice(separatorIndex + 1);
    } else {
      entryGlobalName = remote;
      entry = remote;
    }
    return {
      type: 'var',
      name: key,
      internalName: toInternalModuleFederationName(key),
      entry,
      entryGlobalName,
      shareScope: 'default',
    };
  }
  const normalizedType =
    remote.type ||
    (remote.format === 'var'
      ? 'var'
      : remote.format === 'systemjs'
        ? 'system'
        : remote.format === 'esm'
          ? 'module'
          : undefined);
  return Object.assign(
    {
      type: normalizedType || 'var',
      format: remote.format || normalizedType || 'var',
      from: remote.from || 'vite',
      name: key,
      internalName: toInternalModuleFederationName(key),
      shareScope: 'default',
      entryGlobalName: key,
    },
    {
      ...remote,
      internalName: toInternalModuleFederationName(remote.name || key),
    }
  );
}

export interface ShareItem {
  name: string;
  version: string | undefined;
  scope: string;
  from: string;
  shareConfig: ShareConfigWithImport;
}

/**
 * Tries to find the package.json's version of a shared package
 * if `package.json` is not declared in `exports`
 * @param {string} sharedName
 * @returns {string | undefined}
 */
function searchPackageVersion(sharedName: string): string | undefined {
  try {
    const projectRequire = createRequire(process.cwd());
    const sharedPath = projectRequire.resolve(sharedName);
    let potentialPackageJsonDir = path.dirname(sharedPath);
    const rootDir = path.parse(potentialPackageJsonDir).root;
    while (
      path.parse(potentialPackageJsonDir).base !== 'node_modules' &&
      potentialPackageJsonDir !== rootDir
    ) {
      const potentialPackageJsonPath = path.join(potentialPackageJsonDir, 'package.json');
      if (fs.existsSync(potentialPackageJsonPath)) {
        const potentialPackageJsonContent = fs.readFileSync(potentialPackageJsonPath, 'utf-8');
        try {
          const potentialPackageJson = JSON.parse(potentialPackageJsonContent);
          if (
            typeof potentialPackageJson == 'object' &&
            potentialPackageJson !== null &&
            typeof potentialPackageJson.version === 'string' &&
            potentialPackageJson.name === sharedName
          ) {
            return potentialPackageJson.version;
          }
        } catch (error) {
          // Skip malformed package.json and continue searching up the tree
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
      potentialPackageJsonDir = path.dirname(potentialPackageJsonDir);
    }
  } catch (_) {}
  return undefined;
}

function inferVersionFromRequiredVersion(requiredVersion?: string): string | undefined {
  if (!requiredVersion) return undefined;
  const match = requiredVersion.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0];
}

function getLitExportSubpathShares(sharedName: string): string[] {
  if (sharedName !== 'lit') return [];

  const installedPackageJson = getInstalledPackageJson(sharedName, { packageName: sharedName });
  const exportsField = installedPackageJson?.packageJson.exports;
  if (!exportsField || typeof exportsField === 'string') return [];

  return Object.keys(exportsField as Record<string, unknown>)
    .filter((key) => key.startsWith('./') && key !== '.' && !key.includes('*'))
    .map((key) => `${sharedName}/${key.slice(2)}`);
}

function normalizeShareItem(
  key: string,
  shareItem:
    | string
      | {
        name: string;
        import?: ShareImportOption;
        version?: string;
        shareScope?: string;
        singleton?: boolean;
        requiredVersion?: string;
        strictVersion?: boolean;
      }
): ShareItem {
  let version: string | undefined;

  const isImportFalse = typeof shareItem === 'object' && shareItem.import === false;

  // Skip package.json resolution when import: false — this app doesn't
  // provide the package, so it may not be installed at all.
  if (!isImportFalse) {
    try {
      const projectRequire = createRequire(path.join(process.cwd(), 'package.json'));
      try {
        version = projectRequire(path.join(removePathFromNpmPackage(key), 'package.json')).version;
      } catch (e1) {
        try {
          const localPath = path.join(
            process.cwd(),
            'node_modules',
            removePathFromNpmPackage(key),
            'package.json'
          );
          version = projectRequire(localPath).version;
        } catch (e2) {
          version = searchPackageVersion(key);
          if (!version) mfError(e1);
        }
      }
    } catch (e) {
      mfError(`Unexpected error resolving version for ${key}:`, e);
    }
  }
  if (typeof shareItem === 'string') {
    return {
      name: shareItem,
      version,
      scope: 'default',
      from: '',
      shareConfig: {
        import: undefined,
        singleton: false,
        requiredVersion: version ? `^${version}` : '*',
      },
    };
  }
  const explicitVersion =
    shareItem.version || inferVersionFromRequiredVersion(shareItem.requiredVersion);
  return {
    name: key,
    from: '',
    version: explicitVersion || version,
    scope: shareItem.shareScope || 'default',
    shareConfig: {
      import: typeof shareItem === 'object' ? shareItem.import : undefined,
      singleton: shareItem.singleton || false,
      requiredVersion: shareItem.requiredVersion || (version ? `^${version}` : '*'),
      strictVersion: !!shareItem.strictVersion,
    },
  };
}

function normalizeShared(
  shared:
    | string[]
    | Record<
        string,
        | string
        | {
            name?: string;
            version?: string;
            shareScope?: string;
            singleton?: boolean;
            requiredVersion?: string;
            strictVersion?: boolean;
          }
      >
    | undefined
): NormalizedShared {
  if (!shared) return {};
  const result: NormalizedShared = {};
  const sourceEntries: Array<[string, string | Record<string, any>]> = [];
  if (Array.isArray(shared)) {
    shared.forEach((key) => {
      result[key] = normalizeShareItem(key, key);
      sourceEntries.push([key, key]);
    });
  } else if (typeof shared === 'object') {
    Object.keys(shared).forEach((key) => {
      const value = shared[key] as any;
      result[key] = normalizeShareItem(key, value);
      sourceEntries.push([key, value]);
    });
  }

  sourceEntries.forEach(([key, value]) => {
    for (const subpathShare of getLitExportSubpathShares(key)) {
      if (result[subpathShare]) continue;
      result[subpathShare] = normalizeShareItem(subpathShare, value as any);
    }
  });

  return result;
}

function normalizeLibrary(library: any): any {
  if (!library) return undefined;
  return library;
}

export interface PluginManifestOptions {
  filePath?: string;
  disableAssetsAnalyze?: boolean;
  fileName?: string;
}
function normalizeManifest(manifest: ModuleFederationOptions['manifest']) {
  if (manifest === undefined) {
    return true;
  }
  if (typeof manifest === 'boolean') {
    return manifest;
  }
  return {
    ...manifest,
    fileName: manifest.fileName || 'mf-manifest.json',
  };
}

function normalizeCompat(
  compat: ModuleFederationOptions['compat']
): CompatibilityOptions {
  if (compat === false) {
    return {
      originjs: false,
      virtualFederationShim: false,
    };
  }

  if (compat === true || compat === undefined) {
    return {
      originjs: true,
      virtualFederationShim: true,
    };
  }

  return {
    originjs: compat.originjs ?? true,
    virtualFederationShim: compat.virtualFederationShim ?? compat.originjs ?? true,
  };
}

export type ModuleFederationOptions = {
  exposes?:
    | Record<
        string,
        | string
        | {
            import: string;
            css?: ExposeCssOptions;
            dontAppendStylesToHead?: boolean;
          }
      >
    | undefined;
  filename?: string;
  library?: any;
  name: string;
  // remoteType?: string;
  remotes?: Record<string, string | RemoteObjectConfig> | undefined;
  runtime?: any;
  shareScope?: string;
  /**
   * Override the public path used for remote entries
   * Defaults to Vite's base config or "auto" if base is empty
   */
  publicPath?: string;
  /**
   * Controls whether all CSS assets from the bundle should be added to every exposed module.
   * When false (default), the plugin will not process any CSS assets.
   * When true, all CSS assets are bundled into every exposed module.
   */
  bundleAllCSS?: boolean;
  shared?:
    | string[]
    | Record<
        string,
        | string
        | {
            name?: string;
            version?: string;
            shareScope?: string;
            singleton?: boolean;
            requiredVersion?: string;
            strictVersion?: boolean;
            import?: ShareImportOption;
          }
      >
    | undefined;
  runtimePlugins?: Array<string | [string, Record<string, unknown>]>;
  getPublicPath?: string;
  implementation?: string;
  manifest?: PluginManifestOptions | boolean;
  dev?: boolean | PluginDevOptions;
  dts?: boolean | PluginDtsOptions;
  shareStrategy?: ShareStrategy;
  ignoreOrigin?: boolean;
  compat?: boolean | CompatibilityOptions;
  virtualModuleDir?: string;
  hostInitInjectLocation?: HostInitInjectLocationOptions;
  /**
   * Timeout for parsing modules in seconds.
   * Defaults to 10 seconds.
   */
  moduleParseTimeout?: number;
  /**
   * Idle timeout for parsing modules in seconds. When set, the timeout resets
   * on every parsed module and only fires when there has been no module activity
   * for the configured duration. Prefer this over `moduleParseTimeout` for large
   * codebases where the total build time may exceed the fixed timeout.
   */
  moduleParseIdleTimeout?: number;
  /**
   * Allows generate additional remoteEntry file for "var" host environment
   */
  varFilename?: string;
  /**
   * Target environment for the build to enable effective tree-shaking.
   *
   * @see https://module-federation.io/configure/experiments#target
   * @default 'web' (or 'node' if build.ssr is enabled)
   */
  target?: 'web' | 'node';
};

export interface NormalizedModuleFederationOptions extends Omit<
  ModuleFederationOptions,
  'exposes' | 'remotes' | 'shared'
> {
  exposes: Record<string, ExposesItem>;
  filename: string;
  internalName: string;
  library: any;
  remotes: Record<string, RemoteObjectConfig>;
  runtime: any;
  shareScope: string;
  shared: NormalizedShared;
  runtimePlugins: Array<string | [string, Record<string, unknown>]>;
  implementation: string;
  manifest?: PluginManifestOptions | boolean;
  shareStrategy: ShareStrategy;
  compat: CompatibilityOptions;
  virtualModuleDir: string;
  hostInitInjectLocation: HostInitInjectLocationOptions;
  bundleAllCSS: boolean;
  moduleParseTimeout: number;
  moduleParseIdleTimeout?: number;
}

type HostInitInjectLocationOptions = 'entry' | 'html';

interface PluginDevOptions {
  disableLiveReload?: boolean;
  disableHotTypesReload?: boolean;
  disableDynamicRemoteTypeHints?: boolean;
  remoteHmr?: boolean;
}

interface RemoteTypeUrl {
  alias?: string;
  api: string;
  zip: string;
}

interface RemoteTypeUrls {
  [remoteName: string]: RemoteTypeUrl;
}

interface PluginDtsOptions {
  generateTypes?: boolean | DtsRemoteOptions;
  consumeTypes?: boolean | DtsHostOptions;
  tsConfigPath?: string;
  extraOptions?: Record<string, unknown>;
  implementation?: string;
  cwd?: string;
  displayErrorInTerminal?: boolean;
}

interface DtsRemoteOptions {
  tsConfigPath?: string;
  typesFolder?: string;
  compiledTypesFolder?: string;
  deleteTypesFolder?: boolean;
  additionalFilesToCompile?: string[];
  compilerInstance?: 'tsc' | 'vue-tsc' | 'tspc' | string;
  compileInChildProcess?: boolean;
  generateAPITypes?: boolean;
  extractThirdParty?:
    | boolean
    | {
        exclude?: Array<string | RegExp>;
      };
  extractRemoteTypes?: boolean;
  abortOnError?: boolean;
  deleteTsConfig?: boolean;
}

interface DtsHostOptions {
  typesFolder?: string;
  abortOnError?: boolean;
  remoteTypesFolder?: string;
  deleteTypesFolder?: boolean;
  maxRetries?: number;
  consumeAPITypes?: boolean;
  runtimePkgs?: string[];
  remoteTypeUrls?: (() => Promise<RemoteTypeUrls>) | RemoteTypeUrls;
  timeout?: number;
  family?: 4 | 6;
  typesOnBuild?: boolean;
}

let config: NormalizedModuleFederationOptions;

export function getNormalizeModuleFederationOptions() {
  return config;
}

export function getNormalizeShareItem(key: string) {
  const options = getNormalizeModuleFederationOptions();
  const shareItem =
    options.shared[key] ||
    options.shared[removePathFromNpmPackage(key)] ||
    options.shared[removePathFromNpmPackage(key) + '/'];
  return shareItem;
}

export function normalizeModuleFederationOptions(
  options: ModuleFederationOptions
): NormalizedModuleFederationOptions {
  warnOnReservedInternalNamePrefix(options.name, 'containerName');
  if (options.virtualModuleDir && options.virtualModuleDir.includes('/')) {
    throw createModuleFederationError(
      'MFV-001',
      `Invalid virtualModuleDir: "${options.virtualModuleDir}". ` +
        `The virtualModuleDir option cannot contain slashes (/). ` +
        `Please use a single directory name like '__mf__virtual__your_app_name'.`
    );
  }

  return (config = {
    exposes: normalizeExposes(options.exposes),
    filename: options.filename || 'remoteEntry-[hash]',
    internalName: toInternalModuleFederationName(options.name),
    library: normalizeLibrary(options.library),
    name: options.name,
    // remoteType: options.remoteType,
    remotes: normalizeRemotes(options.remotes),
    runtime: options.runtime,
    shareScope: options.shareScope || 'default',
    shared: normalizeShared(options.shared),
    runtimePlugins: options.runtimePlugins || [],
    implementation: options.implementation || currentPackageRequire.resolve('@module-federation/runtime'),
    manifest: normalizeManifest(options.manifest),
    dev: options.dev,
    dts: options.dts,
    getPublicPath: options.getPublicPath,
    publicPath: options.publicPath,
    shareStrategy: options.shareStrategy || 'version-first',
    ignoreOrigin: options.ignoreOrigin || false,
    compat: normalizeCompat(options.compat),
    virtualModuleDir: options.virtualModuleDir || '__mf__virtual',
    hostInitInjectLocation: options.hostInitInjectLocation || 'html',
    bundleAllCSS: options.bundleAllCSS || false,
    moduleParseTimeout: options.moduleParseTimeout || 10,
    moduleParseIdleTimeout: options.moduleParseIdleTimeout,
    varFilename: options.varFilename,
    target: options.target,
  });
}
