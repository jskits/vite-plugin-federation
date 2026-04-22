import {
  getInstance as getRuntimeInstance,
  getRemoteEntry,
  getRemoteInfo,
  init as initRuntimeInstance,
  loadRemote as loadRuntimeRemote,
  loadScript,
  loadScriptNode,
  loadShare as loadRuntimeShare,
  loadShareSync as loadRuntimeShareSync,
  preloadRemote as preloadRuntimeRemote,
  registerGlobalPlugins,
  registerPlugins as registerRuntimePlugins,
  registerRemotes as registerRuntimeRemotes,
  registerShared as registerRuntimeShared,
} from '@module-federation/runtime';
import type { ModuleFederation } from '@module-federation/runtime';
import type { UserOptions } from '@module-federation/runtime/types';
import type * as NodeVm from 'node:vm';
import {
  createModuleFederationError,
  getModuleFederationDebugState,
  mfErrorWithCode,
  mfWarnWithCode,
  type ModuleFederationErrorCode,
} from '../utils/logger';
import { assertSupportedFederationManifestSchemaVersion } from '../utils/manifestProtocol';

const MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL = Symbol.for('vite-plugin-federation.runtime.debug');
const NODE_TARGET_QUERY_KEY = 'mf_target';
const NODE_TARGET_QUERY_VALUE = 'node';
const STYLE_REQUEST_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss)$/i;
const NODE_RUNTIME_ENTRY_LOADER_PLUGIN_NAME = 'vite-plugin-federation:node-entry-loader';
const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const NODE_VM_IMPORT_GLOBAL_KEY = '__VITE_PLUGIN_FEDERATION_IMPORT_NODE_VM__';
const MANIFEST_URL_RE = /(?:^|\/)(?:mf-)?manifest(?:\.[\w-]+)?\.json(?:$|[?#])/i;
const SHARED_DIAGNOSTICS_PLUGIN_NAME = 'vite-plugin-federation:shared-diagnostics';
const MAX_SHARED_RESOLUTION_EVENTS = 100;

export type FederationRuntimeTarget = 'web' | 'node';

export interface FederationRemoteManifestEntry {
  contentHash?: string;
  integrity?: string;
  name?: string;
  path?: string;
  type?: string;
}

export interface FederationManifestAssetGroup {
  async?: string[];
  sync?: string[];
}

export interface FederationManifestAssets {
  css?: FederationManifestAssetGroup;
  js?: FederationManifestAssetGroup;
}

export interface FederationManifestExpose {
  assets?: FederationManifestAssets;
  css?: {
    mode?: string;
  };
  id?: string;
  name?: string;
  path?: string;
  [key: string]: unknown;
}

export interface FederationManifestResolvedExposeAssets {
  css: {
    all: string[];
    async: string[];
    sync: string[];
  };
  expose: FederationManifestExpose;
  js: {
    all: string[];
    async: string[];
    sync: string[];
  };
}

export interface FederationManifestPreloadLink {
  assetType: 'css' | 'js';
  crossorigin?: 'anonymous' | 'use-credentials';
  expose: FederationManifestExpose;
  exposePath: string;
  href: string;
  loading: 'async' | 'sync';
  rel: 'modulepreload' | 'stylesheet';
}

export interface CollectFederationManifestPreloadLinksOptions {
  crossorigin?: boolean | 'anonymous' | 'use-credentials';
  includeAsyncCss?: boolean;
  includeAsyncJs?: boolean;
  includeCss?: boolean;
  includeJs?: boolean;
}

export interface FederationRemoteManifest {
  id?: string;
  name: string;
  release?: {
    buildName?: string;
    buildVersion?: string;
    id?: string;
  };
  schemaVersion?: string;
  metaData: {
    buildInfo?: {
      buildName?: string;
      buildVersion?: string;
      releaseId?: string;
    };
    name?: string;
    globalName?: string;
    publicPath?: string;
    remoteEntry?: FederationRemoteManifestEntry;
    ssrRemoteEntry?: FederationRemoteManifestEntry;
    types?: {
      path?: string;
      name?: string;
    };
  };
  exposes?: FederationManifestExpose[] | unknown;
  shared?: unknown;
  [key: string]: unknown;
}

export interface ManifestFetchOptions {
  cache?: boolean;
  cacheTtl?: number;
  fetch?: typeof fetch;
  fetchInit?: RequestInit;
  force?: boolean;
  retries?: number;
  retryDelay?: number | ((attempt: number, error: unknown) => number);
  timeout?: number;
}

export interface RegisterManifestRemoteOptions extends ManifestFetchOptions {
  remoteName?: string;
  shareScope?: string;
  target?: FederationRuntimeTarget;
}

interface ManifestCacheEntry {
  expiresAt: number | null;
  fetchedAt: number;
  manifest: FederationRemoteManifest;
}

interface ManifestFetchLogEntry {
  attempt: number;
  durationMs?: number;
  error?: string;
  manifestUrl: string;
  status: 'cache-hit' | 'failure' | 'retry' | 'success';
  statusCode?: number;
  timestamp: string;
}

type SharedMatchType =
  | 'exact'
  | 'package-root'
  | 'trailing-slash-subpath'
  | 'node-modules-suffix'
  | 'unknown';

type SharedResolutionStatus =
  | 'registered'
  | 'before-load'
  | 'resolved'
  | 'loaded'
  | 'sync-loaded'
  | 'fallback'
  | 'miss'
  | 'error';

interface RuntimeSharedCandidateSnapshot {
  eager?: boolean;
  from?: string | null;
  loaded: boolean;
  loading: boolean;
  provider: string | null;
  requiredVersion?: false | string;
  resolvedImportSource?: string | null;
  scope: string[];
  singleton: boolean;
  sourcePath?: string | null;
  strategy?: string;
  strictSingleton: boolean;
  strictVersion: boolean;
  useIn: string[];
  version: string;
}

interface RuntimeSharedRegistrationSnapshot {
  key: string;
  versions: RuntimeSharedCandidateSnapshot[];
}

interface RuntimeSharedResolutionEntry {
  candidates: RuntimeSharedCandidateSnapshot[];
  consumer: string | null;
  error?: string;
  fallbackSource: 'host-only' | 'local-fallback' | 'none' | 'runtime-share' | 'unknown';
  id: number;
  matchType: SharedMatchType;
  pkgName: string;
  reason: string;
  requestedResolvedImportSource?: string | null;
  requestedSourcePath?: string | null;
  requestedVersion?: false | string;
  rejected: RuntimeSharedCandidateSnapshot[];
  selected: RuntimeSharedCandidateSnapshot | null;
  shareScope: string[];
  singleton: boolean;
  strictSingleton: boolean;
  status: SharedResolutionStatus;
  strategy?: string;
  strictVersion: boolean;
  timestamp: string;
  versionSatisfied?: boolean;
}

interface RuntimeDebugState {
  lastLoadError: {
    code: ModuleFederationErrorCode;
    message: string;
    remoteId: string;
    timestamp: string;
  } | null;
  lastLoadRemote: {
    remoteId: string;
    timestamp: string;
  } | null;
  lastPreloadRemote: unknown[] | null;
  registeredRemotes: Array<Record<string, unknown>>;
  registeredShared: RuntimeSharedRegistrationSnapshot[];
  registeredSharedKeys: string[];
  sharedResolutionGraph: RuntimeSharedResolutionEntry[];
  sharedResolutionSeq: number;
  manifestCache: Map<string, ManifestCacheEntry>;
  manifestFetches: ManifestFetchLogEntry[];
  manifestRequests: Map<string, Promise<FederationRemoteManifest>>;
  registrationRequests: Map<string, Promise<Record<string, unknown>>>;
  registeredManifestRemotes: Map<
    string,
    {
      alias: string;
      entry: string;
      entryGlobalName: string;
      manifestUrl: string;
      name: string;
      shareScope: string;
      target: FederationRuntimeTarget;
      type: string;
    }
  >;
}

interface FederationRuntimePluginLike {
  name: string;
  loadEntry?: (args: {
    remoteInfo?: {
      entry?: string;
      type?: string;
    };
    remoteEntryExports?: unknown;
  }) => Promise<unknown> | unknown;
}

type FederationRuntimePlugins = NonNullable<UserOptions['plugins']>;
const nodeRuntimeModuleCache = new Map<string, Promise<any>>();
type NodeVmModule = typeof NodeVm;
type RuntimeSharedLike = {
  deps?: unknown;
  eager?: unknown;
  from?: unknown;
  get?: unknown;
  lib?: unknown;
  loaded?: unknown;
  loading?: unknown;
  scope?: unknown;
  shareConfig?: {
    eager?: unknown;
    import?: unknown;
    requiredVersion?: unknown;
    singleton?: unknown;
    strictSingleton?: unknown;
    strictVersion?: unknown;
    resolvedImportSource?: unknown;
  };
  sourcePath?: unknown;
  strategy?: unknown;
  useIn?: unknown;
  version?: unknown;
};
type RuntimeSharedOptionsLike = Record<string, RuntimeSharedLike | RuntimeSharedLike[]>;
type RuntimeShareScopeMapLike = Record<string, Record<string, Record<string, RuntimeSharedLike>>>;
type RuntimeInstanceWithInternals = ModuleFederation & {
  options?: {
    name?: string;
    remotes?: Array<Record<string, unknown>>;
    shared?: RuntimeSharedOptionsLike;
    shareStrategy?: string;
  };
  shareScopeMap?: RuntimeShareScopeMapLike;
};

async function importNodeVmModule(): Promise<NodeVmModule> {
  const globalImportHook = (
    globalThis as typeof globalThis & {
      [NODE_VM_IMPORT_GLOBAL_KEY]?: () => Promise<NodeVmModule>;
    }
  )[NODE_VM_IMPORT_GLOBAL_KEY];

  if (globalImportHook) {
    return globalImportHook();
  }

  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<NodeVmModule>;
  return dynamicImport('node:vm');
}

type RuntimeDebugEventName =
  | 'create-instance'
  | 'register-remotes'
  | 'register-shared'
  | 'shared-resolution'
  | 'load-remote'
  | 'refresh-remote'
  | 'load-error'
  | 'manifest-fetched'
  | 'manifest-registered'
  | 'clear-caches';

function getRuntimeDebugState(): RuntimeDebugState {
  const state = globalThis as typeof globalThis & {
    [MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL]?: RuntimeDebugState;
  };

  state[MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL] ||= {
    lastLoadError: null,
    lastLoadRemote: null,
    lastPreloadRemote: null,
    registeredRemotes: [],
    registeredShared: [],
    registeredSharedKeys: [],
    sharedResolutionGraph: [],
    sharedResolutionSeq: 0,
    manifestCache: new Map(),
    manifestFetches: [],
    manifestRequests: new Map(),
    registrationRequests: new Map(),
    registeredManifestRemotes: new Map(),
  };

  return state[MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL];
}

function normalizeSharedScope(scope: unknown): string[] {
  if (Array.isArray(scope)) {
    return scope.filter((item): item is string => typeof item === 'string');
  }
  if (typeof scope === 'string') {
    return [scope];
  }
  return ['default'];
}

function getPackageRootName(pkgName: string) {
  if (pkgName.startsWith('@')) {
    const [scope, name] = pkgName.split('/');
    return scope && name ? `${scope}/${name}` : pkgName;
  }
  return pkgName.split('/')[0] || pkgName;
}

function parseComparableVersion(version: string) {
  const normalized = version.trim().replace(/^v/, '').split('-')[0];
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return undefined;

  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] as const;
}

function compareComparableVersions(a: string, b: string) {
  const versionA = parseComparableVersion(a);
  const versionB = parseComparableVersion(b);
  if (!versionA || !versionB) return a.localeCompare(b);

  for (let index = 0; index < 3; index += 1) {
    const diff = versionA[index] - versionB[index];
    if (diff !== 0) return diff;
  }
  return 0;
}

function isComparableVersionGreaterThanOrEqual(version: string, minimum: string) {
  return compareComparableVersions(version, minimum) >= 0;
}

function isComparableVersionLessThan(version: string, maximum: string) {
  return compareComparableVersions(version, maximum) < 0;
}

function getCaretUpperBound(version: string) {
  const parsed = parseComparableVersion(version);
  if (!parsed) return undefined;
  const [major, minor, patch] = parsed;
  if (major > 0) return `${major + 1}.0.0`;
  if (minor > 0) return `0.${minor + 1}.0`;
  return `0.0.${patch + 1}`;
}

function getTildeUpperBound(version: string) {
  const parsed = parseComparableVersion(version);
  if (!parsed) return undefined;
  const [major, minor] = parsed;
  return `${major}.${minor + 1}.0`;
}

function satisfiesComparator(version: string, comparator: string) {
  const trimmed = comparator.trim();
  if (!trimmed || trimmed === '*' || trimmed.toLowerCase() === 'x') return true;

  const operatorMatch = trimmed.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!operatorMatch) return false;
  const operator = operatorMatch[1] || '=';
  const expected = operatorMatch[2].trim();
  if (!parseComparableVersion(version) || !parseComparableVersion(expected)) {
    return version === expected;
  }

  if (operator === '>=') return compareComparableVersions(version, expected) >= 0;
  if (operator === '<=') return compareComparableVersions(version, expected) <= 0;
  if (operator === '>') return compareComparableVersions(version, expected) > 0;
  if (operator === '<') return compareComparableVersions(version, expected) < 0;
  return compareComparableVersions(version, expected) === 0;
}

function satisfiesSharedVersionRange(version: string, range: false | string | undefined) {
  if (range === undefined || range === false || range === '*' || range.trim() === '') return true;

  return range.split('||').some((rangePart) => {
    const trimmedRange = rangePart.trim();
    if (!trimmedRange) return true;

    if (trimmedRange.startsWith('^')) {
      const minimum = trimmedRange.slice(1).trim();
      const maximum = getCaretUpperBound(minimum);
      return (
        Boolean(maximum) &&
        isComparableVersionGreaterThanOrEqual(version, minimum) &&
        isComparableVersionLessThan(version, maximum as string)
      );
    }

    if (trimmedRange.startsWith('~')) {
      const minimum = trimmedRange.slice(1).trim();
      const maximum = getTildeUpperBound(minimum);
      return (
        Boolean(maximum) &&
        isComparableVersionGreaterThanOrEqual(version, minimum) &&
        isComparableVersionLessThan(version, maximum as string)
      );
    }

    return trimmedRange
      .split(/\s+/)
      .every((comparator) => satisfiesComparator(version, comparator));
  });
}

function sortSharedCandidates(candidates: RuntimeSharedCandidateSnapshot[]) {
  return [...candidates].sort((a, b) => {
    const versionDiff = compareComparableVersions(a.version, b.version);
    if (versionDiff !== 0) return versionDiff;
    return (a.provider || '').localeCompare(b.provider || '');
  });
}

function getSharedVersionSatisfied(
  selected: RuntimeSharedCandidateSnapshot | null,
  requiredVersion: false | string | undefined,
) {
  if (!selected || requiredVersion === undefined || requiredVersion === false) return undefined;
  return satisfiesSharedVersionRange(selected.version, requiredVersion);
}

function warnSharedVersionMismatch(
  pkgName: string,
  selected: RuntimeSharedCandidateSnapshot | null,
  requiredVersion: false | string | undefined,
  strictVersion: boolean,
  scope: string[],
) {
  if (!selected || requiredVersion === undefined || requiredVersion === false) return;
  if (satisfiesSharedVersionRange(selected.version, requiredVersion)) return;

  const log = strictVersion ? mfErrorWithCode : mfWarnWithCode;
  log(
    'MFV-003',
    `Shared module "${pkgName}" selected version "${selected.version}" from "${selected.provider || 'unknown provider'}" does not satisfy requiredVersion "${requiredVersion}".`,
    {
      pkgName,
      provider: selected.provider,
      requiredVersion,
      scope,
      selectedVersion: selected.version,
      strictVersion,
    },
  );
}

function inferSharedMatchType(
  pkgName: string,
  sharedOptions?: RuntimeSharedOptionsLike,
): SharedMatchType {
  if (!sharedOptions) return 'unknown';
  if (Object.prototype.hasOwnProperty.call(sharedOptions, pkgName)) return 'exact';

  const packageRoot = getPackageRootName(pkgName);
  if (packageRoot !== pkgName && Object.prototype.hasOwnProperty.call(sharedOptions, packageRoot)) {
    return 'package-root';
  }
  if (
    packageRoot !== pkgName &&
    Object.prototype.hasOwnProperty.call(sharedOptions, `${packageRoot}/`)
  ) {
    return 'trailing-slash-subpath';
  }

  return 'unknown';
}

function toRuntimeSharedCandidateSnapshot(
  shared: RuntimeSharedLike | undefined,
  fallbackVersion = '0',
): RuntimeSharedCandidateSnapshot {
  const shareConfig = shared?.shareConfig || {};
  const version =
    typeof shared?.version === 'string' || typeof shared?.version === 'number'
      ? String(shared.version)
      : fallbackVersion;
  const from = typeof shared?.from === 'string' ? shared.from : null;
  const scope = normalizeSharedScope(shared?.scope);
  const useIn = Array.isArray(shared?.useIn)
    ? shared.useIn.filter((item): item is string => typeof item === 'string')
    : [];
  const requiredVersion =
    typeof shareConfig.requiredVersion === 'string' || shareConfig.requiredVersion === false
      ? shareConfig.requiredVersion
      : undefined;

  return {
    eager: Boolean(shared?.eager || shareConfig.eager),
    from,
    loaded: Boolean(shared?.loaded || typeof shared?.lib === 'function'),
    loading: Boolean(shared?.loading),
    provider: from,
    requiredVersion,
    resolvedImportSource:
      typeof shareConfig.resolvedImportSource === 'string'
        ? shareConfig.resolvedImportSource
        : null,
    scope,
    singleton: shareConfig.singleton === true,
    sourcePath: typeof shared?.sourcePath === 'string' ? shared.sourcePath : null,
    strategy: typeof shared?.strategy === 'string' ? shared.strategy : undefined,
    strictSingleton: shareConfig.strictSingleton === true,
    strictVersion: shareConfig.strictVersion === true,
    useIn,
    version,
  };
}

function snapshotSharedOptions(
  sharedOptions?: RuntimeSharedOptionsLike,
): RuntimeSharedRegistrationSnapshot[] {
  if (!sharedOptions) return [];

  return Object.entries(sharedOptions).map(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return {
      key,
      versions: sortSharedCandidates(
        values.map((shared) => toRuntimeSharedCandidateSnapshot(shared)),
      ),
    };
  });
}

function snapshotShareScopeMap(
  shareScopeMap?: RuntimeShareScopeMapLike,
): RuntimeSharedRegistrationSnapshot[] {
  if (!shareScopeMap) return [];

  const merged = new Map<string, RuntimeSharedCandidateSnapshot[]>();
  for (const [scopeName, packages] of Object.entries(shareScopeMap)) {
    for (const [pkgName, versions] of Object.entries(packages || {})) {
      const snapshots = merged.get(pkgName) || [];
      for (const [version, shared] of Object.entries(versions || {})) {
        snapshots.push(
          toRuntimeSharedCandidateSnapshot(
            {
              ...shared,
              scope: shared.scope || [scopeName],
              version: shared.version || version,
            },
            version,
          ),
        );
      }
      merged.set(pkgName, snapshots);
    }
  }

  return [...merged.entries()].map(([key, versions]) => ({
    key,
    versions: sortSharedCandidates(versions),
  }));
}

function getRuntimeConsumerName(runtimeInstance: RuntimeInstanceWithInternals | null) {
  return runtimeInstance?.options?.name || runtimeInstance?.name || null;
}

function getRuntimeSharedCandidates(
  pkgName: string,
  runtimeInstance: RuntimeInstanceWithInternals | null,
  shareScopes?: string[],
) {
  const shareScopeMap = runtimeInstance?.shareScopeMap;
  if (!shareScopeMap) return [];

  const candidates: RuntimeSharedCandidateSnapshot[] = [];
  const scopeNames = shareScopes?.length ? shareScopes : Object.keys(shareScopeMap);
  for (const scopeName of scopeNames) {
    const versionMap = shareScopeMap[scopeName]?.[pkgName];
    if (!versionMap) continue;
    for (const [version, shared] of Object.entries(versionMap)) {
      candidates.push(
        toRuntimeSharedCandidateSnapshot(
          {
            ...shared,
            scope: shared.scope || [scopeName],
            version: shared.version || version,
          },
          version,
        ),
      );
    }
  }

  return sortSharedCandidates(candidates);
}

function getSelectedSharedCandidate(
  candidates: RuntimeSharedCandidateSnapshot[],
  consumer: string | null,
) {
  return (
    candidates.find((candidate) => consumer && candidate.useIn.includes(consumer)) ||
    candidates.find((candidate) => candidate.loaded) ||
    candidates.find((candidate) => candidate.loading) ||
    null
  );
}

function getRejectedSharedCandidates(
  candidates: RuntimeSharedCandidateSnapshot[],
  selected: RuntimeSharedCandidateSnapshot | null,
) {
  if (!selected) return [];
  return candidates.filter(
    (candidate) =>
      candidate.version !== selected.version ||
      candidate.provider !== selected.provider ||
      candidate.scope.join(',') !== selected.scope.join(','),
  );
}

function getDistinctRejectedVersions(rejected: RuntimeSharedCandidateSnapshot[]) {
  return [...new Set(rejected.map((candidate) => candidate.version))].sort(
    compareComparableVersions,
  );
}

function isModuleFederationErrorCode(error: unknown, code: ModuleFederationErrorCode) {
  return error instanceof Error && (error as Error & { code?: unknown }).code === code;
}

function reportSingletonConflict(
  pkgName: string,
  selected: RuntimeSharedCandidateSnapshot | null,
  rejected: RuntimeSharedCandidateSnapshot[],
  singleton: boolean,
  strictSingleton: boolean,
  scope: string[],
) {
  const rejectedVersions = getDistinctRejectedVersions(rejected);
  if (!singleton || !selected || rejectedVersions.length === 0) return;

  const message = `Shared singleton "${pkgName}" selected version "${selected.version}" and rejected ${rejectedVersions.join(', ')}.`;
  const details = {
    pkgName,
    rejectedVersions,
    scope,
    selectedProvider: selected.provider,
    selectedVersion: selected.version,
    strictSingleton,
  };

  if (strictSingleton) {
    throw createModuleFederationError('MFV-003', message);
  }

  mfWarnWithCode('MFV-003', message, details);
}

function getRequestedShareConfig(
  pkgName: string,
  runtimeInstance: RuntimeInstanceWithInternals | null,
  extraOptions?: unknown,
) {
  const sharedOptions = runtimeInstance?.options?.shared;
  const optionsValue = sharedOptions?.[pkgName];
  const optionsShared = (Array.isArray(optionsValue) ? optionsValue[0] : optionsValue) as
    | RuntimeSharedLike
    | undefined;
  const customShareInfo =
    extraOptions &&
    typeof extraOptions === 'object' &&
    'customShareInfo' in extraOptions &&
    extraOptions.customShareInfo &&
    typeof extraOptions.customShareInfo === 'object'
      ? (extraOptions.customShareInfo as RuntimeSharedLike)
      : undefined;
  const mergedShareConfig = {
    ...(optionsShared?.shareConfig || {}),
    ...(customShareInfo?.shareConfig || {}),
  };
  const sourcePath =
    typeof customShareInfo?.sourcePath === 'string'
      ? customShareInfo.sourcePath
      : typeof optionsShared?.sourcePath === 'string'
        ? optionsShared.sourcePath
        : null;
  const resolvedImportSource =
    typeof mergedShareConfig.resolvedImportSource === 'string'
      ? mergedShareConfig.resolvedImportSource
      : null;

  return {
    resolvedImportSource,
    scope: normalizeSharedScope(customShareInfo?.scope || optionsShared?.scope),
    shareConfig: mergedShareConfig,
    sourcePath,
    strategy:
      (typeof customShareInfo?.strategy === 'string' ? customShareInfo.strategy : undefined) ||
      (typeof optionsShared?.strategy === 'string' ? optionsShared.strategy : undefined) ||
      runtimeInstance?.options?.shareStrategy,
  };
}

function pushSharedResolution(entry: Omit<RuntimeSharedResolutionEntry, 'id' | 'timestamp'>) {
  const debugState = getRuntimeDebugState();
  debugState.sharedResolutionSeq += 1;
  debugState.sharedResolutionGraph.push({
    ...entry,
    id: debugState.sharedResolutionSeq,
    timestamp: new Date().toISOString(),
  });
  if (debugState.sharedResolutionGraph.length > MAX_SHARED_RESOLUTION_EVENTS) {
    debugState.sharedResolutionGraph.shift();
  }
}

function recordSharedResolutionFromLoad(
  pkgName: string,
  extraOptions: unknown,
  result: unknown,
  mode: 'async' | 'sync',
) {
  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;
  const consumer = getRuntimeConsumerName(runtimeInstance);
  const requested = getRequestedShareConfig(pkgName, runtimeInstance, extraOptions);
  const candidates = getRuntimeSharedCandidates(pkgName, runtimeInstance, requested.scope);
  const selected = getSelectedSharedCandidate(candidates, consumer);
  const rejected = getRejectedSharedCandidates(candidates, selected);
  const shareConfig = requested.shareConfig;
  const isHostOnly = shareConfig && 'import' in shareConfig && shareConfig.import === false;
  const status: SharedResolutionStatus =
    result === false ? 'fallback' : mode === 'sync' ? 'sync-loaded' : 'loaded';
  const requestedVersion =
    typeof shareConfig?.requiredVersion === 'string' || shareConfig?.requiredVersion === false
      ? shareConfig.requiredVersion
      : undefined;
  const versionSatisfied = getSharedVersionSatisfied(selected, requestedVersion);

  pushSharedResolution({
    candidates,
    consumer,
    fallbackSource:
      result === false ? (isHostOnly ? 'host-only' : 'local-fallback') : 'runtime-share',
    matchType: inferSharedMatchType(pkgName, runtimeInstance?.options?.shared),
    pkgName,
    reason:
      result === false
        ? 'No registered shared provider matched; runtime returned false for local fallback.'
        : selected
          ? `Selected ${selected.version} from ${selected.provider || 'unknown provider'}.`
          : 'Shared module loaded but selected provider could not be inferred from share scope.',
    requestedResolvedImportSource: requested.resolvedImportSource,
    requestedSourcePath: requested.sourcePath,
    requestedVersion,
    rejected,
    selected,
    shareScope: requested.scope,
    singleton: shareConfig?.singleton === true,
    status,
    strategy: requested.strategy,
    strictSingleton: shareConfig?.strictSingleton === true,
    strictVersion: shareConfig?.strictVersion === true,
    versionSatisfied,
  });

  reportSingletonConflict(
    pkgName,
    selected,
    rejected,
    shareConfig?.singleton === true,
    shareConfig?.strictSingleton === true,
    requested.scope,
  );

  if (result === false) {
    mfWarnWithCode(
      'MFV-003',
      `Shared module "${pkgName}" was not found in the registered share scope; local fallback will be used if available.`,
      {
        fallbackSource: isHostOnly ? 'host-only' : 'local-fallback',
        pkgName,
        requiredVersion: shareConfig?.requiredVersion,
      },
    );
  }
}

function recordSharedResolutionError(pkgName: string, extraOptions: unknown, error: unknown) {
  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;
  const requested = getRequestedShareConfig(pkgName, runtimeInstance, extraOptions);
  const candidates = getRuntimeSharedCandidates(pkgName, runtimeInstance, requested.scope);
  const shareConfig = requested.shareConfig;
  const message = error instanceof Error ? error.message : String(error);
  const requestedVersion =
    typeof shareConfig?.requiredVersion === 'string' || shareConfig?.requiredVersion === false
      ? shareConfig.requiredVersion
      : undefined;

  pushSharedResolution({
    candidates,
    consumer: getRuntimeConsumerName(runtimeInstance),
    error: message,
    fallbackSource: 'none',
    matchType: inferSharedMatchType(pkgName, runtimeInstance?.options?.shared),
    pkgName,
    reason: `Shared module resolution failed: ${message}`,
    requestedResolvedImportSource: requested.resolvedImportSource,
    requestedSourcePath: requested.sourcePath,
    requestedVersion,
    rejected: [],
    selected: null,
    shareScope: requested.scope,
    singleton: shareConfig?.singleton === true,
    status: 'error',
    strategy: requested.strategy,
    strictSingleton: shareConfig?.strictSingleton === true,
    strictVersion: shareConfig?.strictVersion === true,
    versionSatisfied: undefined,
  });
  mfErrorWithCode('MFV-003', `Shared module "${pkgName}" failed to resolve.`, {
    error: message,
    pkgName,
    requiredVersion: shareConfig?.requiredVersion,
  });
}

function createSharedDiagnosticsRuntimePlugin() {
  return {
    name: SHARED_DIAGNOSTICS_PLUGIN_NAME,
    beforeRegisterShare(args: {
      pkgName: string;
      shared: RuntimeSharedLike;
      origin: RuntimeInstanceWithInternals;
    }) {
      pushSharedResolution({
        candidates: [toRuntimeSharedCandidateSnapshot(args.shared)],
        consumer: getRuntimeConsumerName(args.origin),
        fallbackSource: 'none',
        matchType: inferSharedMatchType(args.pkgName, args.origin.options?.shared),
        pkgName: args.pkgName,
        reason: `Registered shared provider ${args.shared.from || args.origin.options?.name || 'unknown'} for ${args.pkgName}.`,
        requestedVersion:
          typeof args.shared.shareConfig?.requiredVersion === 'string' ||
          args.shared.shareConfig?.requiredVersion === false
            ? args.shared.shareConfig.requiredVersion
            : undefined,
        rejected: [],
        selected: null,
        shareScope: normalizeSharedScope(args.shared.scope),
        singleton: args.shared.shareConfig?.singleton === true,
        status: 'registered',
        strategy: typeof args.shared.strategy === 'string' ? args.shared.strategy : undefined,
        strictSingleton: args.shared.shareConfig?.strictSingleton === true,
        strictVersion: args.shared.shareConfig?.strictVersion === true,
        versionSatisfied: undefined,
      });
      return args;
    },
    beforeLoadShare(args: {
      pkgName: string;
      shareInfo?: RuntimeSharedLike;
      shared: RuntimeSharedOptionsLike;
      origin: RuntimeInstanceWithInternals;
    }) {
      pushSharedResolution({
        candidates: getRuntimeSharedCandidates(
          args.pkgName,
          args.origin,
          normalizeSharedScope(args.shareInfo?.scope),
        ),
        consumer: getRuntimeConsumerName(args.origin),
        fallbackSource: 'unknown',
        matchType: inferSharedMatchType(args.pkgName, args.shared),
        pkgName: args.pkgName,
        reason: `Runtime started resolving shared module "${args.pkgName}".`,
        requestedResolvedImportSource:
          typeof args.shareInfo?.shareConfig?.resolvedImportSource === 'string'
            ? args.shareInfo.shareConfig.resolvedImportSource
            : null,
        requestedSourcePath:
          typeof args.shareInfo?.sourcePath === 'string' ? args.shareInfo.sourcePath : null,
        requestedVersion:
          typeof args.shareInfo?.shareConfig?.requiredVersion === 'string' ||
          args.shareInfo?.shareConfig?.requiredVersion === false
            ? args.shareInfo.shareConfig.requiredVersion
            : undefined,
        rejected: [],
        selected: null,
        shareScope: normalizeSharedScope(args.shareInfo?.scope),
        singleton: args.shareInfo?.shareConfig?.singleton === true,
        status: 'before-load',
        strategy:
          typeof args.shareInfo?.strategy === 'string' ? args.shareInfo.strategy : undefined,
        strictSingleton: args.shareInfo?.shareConfig?.strictSingleton === true,
        strictVersion: args.shareInfo?.shareConfig?.strictVersion === true,
        versionSatisfied: undefined,
      });
      return args;
    },
    resolveShare(args: {
      pkgName: string;
      resolver: () =>
        | {
            shared: RuntimeSharedLike;
            useTreesShaking: boolean;
          }
        | undefined;
      scope: string;
      shareInfo: RuntimeSharedLike;
      shareScopeMap: RuntimeShareScopeMapLike;
      version: string;
    }) {
      try {
        const resolved = args.resolver();
        const candidates = getRuntimeSharedCandidates(args.pkgName, {
          name: 'diagnostics',
          options: { name: 'diagnostics', remotes: [], shared: {} },
          shareScopeMap: args.shareScopeMap,
        } as unknown as RuntimeInstanceWithInternals);
        const selected = resolved?.shared
          ? toRuntimeSharedCandidateSnapshot(resolved.shared, args.version)
          : null;
        const rejected = getRejectedSharedCandidates(candidates, selected);
        const requestedVersion =
          typeof args.shareInfo.shareConfig?.requiredVersion === 'string' ||
          args.shareInfo.shareConfig?.requiredVersion === false
            ? args.shareInfo.shareConfig.requiredVersion
            : undefined;
        const strictVersion = args.shareInfo.shareConfig?.strictVersion === true;
        const versionSatisfied = getSharedVersionSatisfied(selected, requestedVersion);

        pushSharedResolution({
          candidates,
          consumer: typeof args.shareInfo.from === 'string' ? args.shareInfo.from : null,
          fallbackSource: selected ? 'runtime-share' : 'none',
          matchType: 'exact',
          pkgName: args.pkgName,
          reason: selected
            ? versionSatisfied === false
              ? `Resolved ${args.pkgName} to ${selected.version}, but it does not satisfy ${requestedVersion}.`
              : rejected.length > 0 && args.shareInfo.shareConfig?.singleton === true
                ? `Resolved singleton ${args.pkgName} to ${selected.version} and rejected ${getDistinctRejectedVersions(rejected).join(', ')}.`
                : `Resolved ${args.pkgName} to ${selected.version} from ${selected.provider || 'unknown provider'}.`
            : `No registered shared provider satisfied ${args.pkgName}.`,
          requestedResolvedImportSource:
            typeof args.shareInfo.shareConfig?.resolvedImportSource === 'string'
              ? args.shareInfo.shareConfig.resolvedImportSource
              : null,
          requestedSourcePath:
            typeof args.shareInfo.sourcePath === 'string' ? args.shareInfo.sourcePath : null,
          requestedVersion,
          rejected,
          selected,
          shareScope: [args.scope],
          singleton: args.shareInfo.shareConfig?.singleton === true,
          status: selected ? 'resolved' : 'miss',
          strategy:
            typeof args.shareInfo.strategy === 'string' ? args.shareInfo.strategy : undefined,
          strictSingleton: args.shareInfo.shareConfig?.strictSingleton === true,
          strictVersion,
          versionSatisfied,
        });

        warnSharedVersionMismatch(args.pkgName, selected, requestedVersion, strictVersion, [
          args.scope,
        ]);
        reportSingletonConflict(
          args.pkgName,
          selected,
          rejected,
          args.shareInfo.shareConfig?.singleton === true,
          args.shareInfo.shareConfig?.strictSingleton === true,
          [args.scope],
        );

        if (!selected) {
          mfWarnWithCode('MFV-003', `No shared provider satisfied "${args.pkgName}".`, {
            pkgName: args.pkgName,
            requiredVersion: args.shareInfo.shareConfig?.requiredVersion,
            scope: args.scope,
          });
        }

        return {
          ...args,
          resolver: () => resolved,
        };
      } catch (error) {
        if (isModuleFederationErrorCode(error, 'MFV-003')) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        const candidates = getRuntimeSharedCandidates(args.pkgName, {
          name: 'diagnostics',
          options: { name: 'diagnostics', remotes: [], shared: {} },
          shareScopeMap: args.shareScopeMap,
        } as unknown as RuntimeInstanceWithInternals);

        pushSharedResolution({
          candidates,
          consumer: typeof args.shareInfo.from === 'string' ? args.shareInfo.from : null,
          error: message,
          fallbackSource: 'none',
          matchType: 'exact',
          pkgName: args.pkgName,
          reason: `Shared provider resolution threw: ${message}`,
          requestedResolvedImportSource:
            typeof args.shareInfo.shareConfig?.resolvedImportSource === 'string'
              ? args.shareInfo.shareConfig.resolvedImportSource
              : null,
          requestedSourcePath:
            typeof args.shareInfo.sourcePath === 'string' ? args.shareInfo.sourcePath : null,
          requestedVersion:
            typeof args.shareInfo.shareConfig?.requiredVersion === 'string' ||
            args.shareInfo.shareConfig?.requiredVersion === false
              ? args.shareInfo.shareConfig.requiredVersion
              : undefined,
          rejected: [],
          selected: null,
          shareScope: [args.scope],
          singleton: args.shareInfo.shareConfig?.singleton === true,
          status: 'error',
          strategy:
            typeof args.shareInfo.strategy === 'string' ? args.shareInfo.strategy : undefined,
          strictSingleton: args.shareInfo.shareConfig?.strictSingleton === true,
          strictVersion: args.shareInfo.shareConfig?.strictVersion === true,
          versionSatisfied: undefined,
        });
        mfErrorWithCode('MFV-003', `Shared provider resolution failed for "${args.pkgName}".`, {
          error: message,
          pkgName: args.pkgName,
          requiredVersion: args.shareInfo.shareConfig?.requiredVersion,
          scope: args.scope,
        });
        throw error;
      }
    },
  };
}

function toNodeTargetUrl(origin: string, requestPath: string) {
  const resolved = new URL(
    !requestPath.startsWith('.') &&
      !requestPath.startsWith('/') &&
      !ABSOLUTE_URL_RE.test(requestPath)
      ? `/@id/${requestPath}`
      : requestPath,
    origin,
  );
  resolved.searchParams.set(NODE_TARGET_QUERY_KEY, NODE_TARGET_QUERY_VALUE);
  return resolved.toString();
}

function normalizeNodeTargetModuleCode(code: string, requestUrl: string) {
  if (STYLE_REQUEST_RE.test(new URL(requestUrl).pathname)) {
    return 'export default {};';
  }

  const exportStatements: string[] = [];
  let exportAliasIndex = 0;
  let normalized = code.replace(
    /^__vite_ssr_exportName__\("([^"]+)", \(\) => \{ try \{ return ([^ }]+) \} catch \{\} \}\);\s*$/gm,
    (_match, exportName: string, localName: string) => {
      exportStatements.push(
        exportName === 'default'
          ? `export default ${localName};`
          : `export { ${localName} as ${exportName} };`,
      );
      return '';
    },
  );

  normalized = normalized
    .replace(
      /await\s+__vite_ssr_import__\("([^"]+)"(?:,\s*\{[^)]*\})?\)/g,
      (_match, specifier: string) =>
        `await import(${JSON.stringify(toNodeTargetUrl(requestUrl, specifier))})`,
    )
    .replace(
      /__vite_ssr_dynamic_import__\("([^"]+)"\)/g,
      (_match, specifier: string) =>
        `import(${JSON.stringify(toNodeTargetUrl(requestUrl, specifier))})`,
    )
    .replace(/\b__vite_ssr_import_meta__\.url\b/g, 'import.meta.url')
    .replace(/\b__vite_ssr_import_meta__\b/g, 'import.meta')
    .replace(
      /export\s*\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s+as\s+([A-Za-z_$][\w$]*)\s*\};?/g,
      (_statement, localExpression: string, exportName: string) => {
        const localAlias = `__mf_export_${exportAliasIndex++}__`;
        return `const ${localAlias} = ${localExpression};\nexport { ${localAlias} as ${exportName} };`;
      },
    )
    .replace(/(from\s+["'])(\/[^"']+)(["'])/g, (_match, before, target, after) => {
      return `${before}${toNodeTargetUrl(requestUrl, target)}${after}`;
    })
    .replace(/(import\s+["'])(\/[^"']+)(["'])/g, (_match, before, target, after) => {
      return `${before}${toNodeTargetUrl(requestUrl, target)}${after}`;
    })
    .replace(/(import\(\s*["'])(\/[^"']+)(["']\s*\))/g, (_match, before, target, after) => {
      return `${before}${toNodeTargetUrl(requestUrl, target)}${after}`;
    });

  if (exportStatements.length > 0) {
    normalized = `${normalized.trim()}\n${exportStatements.join('\n')}\n`;
  }

  return normalized;
}

async function loadNodeRuntimeModule(url: string): Promise<any> {
  const cachedModule = nodeRuntimeModuleCache.get(url);
  if (cachedModule) {
    return cachedModule;
  }

  const modulePromise = (async () => {
    if (!globalThis.fetch) {
      throw createModuleFederationError(
        'MFV-004',
        'global fetch is unavailable. Provide a fetch implementation before loading node federation entries.',
      );
    }

    const response = await globalThis.fetch(url);
    if (!response.ok) {
      throw createModuleFederationError(
        'MFV-004',
        `Failed to fetch node federation module "${url}" with status ${response.status}.`,
      );
    }

    const vm = await importNodeVmModule();
    const code = normalizeNodeTargetModuleCode(await response.text(), url);
    const module = new vm.SourceTextModule(code, {
      identifier: url,
      importModuleDynamically: async (specifier) => {
        const importedModule = await loadNodeRuntimeModule(new URL(specifier, url).href);
        await importedModule.evaluate();
        return importedModule;
      },
    });

    await module.link(async (specifier) => {
      return loadNodeRuntimeModule(new URL(specifier, url).href);
    });

    return module;
  })();

  nodeRuntimeModuleCache.set(url, modulePromise);

  try {
    return await modulePromise;
  } catch (error) {
    nodeRuntimeModuleCache.delete(url);
    throw error;
  }
}

async function loadNodeRuntimeModuleNamespace(url: string) {
  const module = await loadNodeRuntimeModule(url);
  await module.evaluate();
  return module.namespace;
}

function createNodeRuntimeEntryLoaderPlugin(): FederationRuntimePluginLike {
  return {
    name: NODE_RUNTIME_ENTRY_LOADER_PLUGIN_NAME,
    async loadEntry({ remoteInfo, remoteEntryExports }) {
      if (
        typeof (globalThis as typeof globalThis & { window?: unknown }).window !== 'undefined' ||
        remoteEntryExports
      ) {
        return remoteEntryExports;
      }

      if (!remoteInfo?.entry) {
        return undefined;
      }

      if (remoteInfo.type && !['module', 'esm'].includes(remoteInfo.type)) {
        return undefined;
      }

      return loadNodeRuntimeModuleNamespace(remoteInfo.entry);
    },
  };
}

function withRuntimePlugins(options: UserOptions) {
  const plugins = [...(options.plugins || [])];
  if (!plugins.some((plugin) => plugin?.name === SHARED_DIAGNOSTICS_PLUGIN_NAME)) {
    plugins.push(
      createSharedDiagnosticsRuntimePlugin() as unknown as FederationRuntimePlugins[number],
    );
  }
  if (
    typeof (globalThis as typeof globalThis & { window?: unknown }).window === 'undefined' &&
    !plugins.some((plugin) => plugin?.name === NODE_RUNTIME_ENTRY_LOADER_PLUGIN_NAME)
  ) {
    plugins.push(createNodeRuntimeEntryLoaderPlugin() as FederationRuntimePlugins[number]);
  }

  return {
    ...options,
    plugins,
  };
}

function getDevtoolsGlobal() {
  const state = globalThis as typeof globalThis & {
    __VITE_PLUGIN_FEDERATION_DEVTOOLS__?: {
      apps?: Record<string, unknown>;
      events?: Array<Record<string, unknown>>;
      lastUpdatedAt?: string;
      runtime?: unknown;
    };
  };

  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__ ||= {};
  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__.events ||= [];

  return state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__;
}

function snapshotInstance(instance: ModuleFederation | null) {
  if (!instance) {
    return null;
  }

  const runtimeInstance = instance as ModuleFederation & {
    name?: string;
    options?: Record<string, unknown>;
  };

  return {
    name: runtimeInstance.name ?? runtimeInstance.options?.name ?? null,
    options: runtimeInstance.options ?? null,
  };
}

function syncRegisteredRemoteDebugState() {
  const debugState = getRuntimeDebugState();
  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;

  const remotes = runtimeInstance?.options?.remotes;
  if (!Array.isArray(remotes)) {
    return;
  }

  debugState.registeredRemotes = remotes.map((remote) => ({ ...remote }));
}

function syncRegisteredSharedDebugState() {
  const debugState = getRuntimeDebugState();
  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;
  const sharedFromScope = snapshotShareScopeMap(runtimeInstance?.shareScopeMap);

  if (sharedFromScope.length > 0) {
    debugState.registeredShared = sharedFromScope;
    debugState.registeredSharedKeys = sharedFromScope.map((shared) => shared.key);
    return;
  }

  const sharedFromOptions = snapshotSharedOptions(runtimeInstance?.options?.shared);
  if (sharedFromOptions.length > 0) {
    debugState.registeredShared = sharedFromOptions;
    debugState.registeredSharedKeys = sharedFromOptions.map((shared) => shared.key);
  }
}

export { getRemoteEntry, getRemoteInfo, loadScript, loadScriptNode, registerGlobalPlugins };

export function getInstance() {
  return getRuntimeInstance();
}

export function createFederationInstance(options: UserOptions) {
  const instance = initRuntimeInstance(withRuntimePlugins(options));
  syncRegisteredSharedDebugState();
  publishRuntimeDebugUpdate('create-instance');
  return instance;
}

export function createServerFederationInstance(options: UserOptions) {
  const instance = initRuntimeInstance({
    ...withRuntimePlugins(options),
    inBrowser: false,
  } as UserOptions);
  syncRegisteredSharedDebugState();
  publishRuntimeDebugUpdate('create-instance');
  return instance;
}

export function registerPlugins(...args: Parameters<ModuleFederation['registerPlugins']>) {
  return registerRuntimePlugins(...args);
}

export function registerRemotes(...args: Parameters<ModuleFederation['registerRemotes']>) {
  const result = registerRuntimeRemotes(...args);
  syncRegisteredRemoteDebugState();
  publishRuntimeDebugUpdate('register-remotes');
  return result;
}

function findRegisteredRuntimeRemote(
  runtimeInstance: RuntimeInstanceWithInternals | null,
  remoteIdentifier: string | undefined,
) {
  if (!remoteIdentifier || !Array.isArray(runtimeInstance?.options?.remotes)) {
    return undefined;
  }

  return runtimeInstance.options.remotes.find((remote) => {
    return remote?.name === remoteIdentifier || remote?.alias === remoteIdentifier;
  });
}

function registerRuntimeRemoteWithReplace(
  remote: Parameters<ModuleFederation['registerRemotes']>[0][number],
  options: {
    force?: boolean;
    remoteIdentifier?: string;
  } = {},
) {
  if (!options.force) {
    return registerRemotes([remote]);
  }

  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;
  const registeredRemote =
    findRegisteredRuntimeRemote(runtimeInstance, options.remoteIdentifier) ||
    findRegisteredRuntimeRemote(
      runtimeInstance,
      typeof remote.alias === 'string' ? remote.alias : undefined,
    ) ||
    findRegisteredRuntimeRemote(
      runtimeInstance,
      typeof remote.name === 'string' ? remote.name : undefined,
    );
  const remoteHandler = (runtimeInstance as { remoteHandler?: { removeRemote?: unknown } } | null)
    ?.remoteHandler;
  const removeRemote = remoteHandler?.removeRemote;

  if (registeredRemote && typeof removeRemote === 'function') {
    removeRemote.call(remoteHandler, registeredRemote);
    return registerRemotes([remote]);
  }

  return registerRemotes([remote], { force: true });
}

export function registerShared(...args: Parameters<ModuleFederation['registerShared']>) {
  const [shared] = args;
  const debugState = getRuntimeDebugState();

  debugState.registeredSharedKeys = shared ? Object.keys(shared) : [];
  debugState.registeredShared = snapshotSharedOptions(shared as RuntimeSharedOptionsLike);
  const result = registerRuntimeShared(...args);
  syncRegisteredSharedDebugState();
  publishRuntimeDebugUpdate('register-shared');
  return result;
}

export async function loadShare<T>(...args: Parameters<ModuleFederation['loadShare']>) {
  const [pkgName, extraOptions] = args;

  try {
    const result = await loadRuntimeShare<T>(...args);
    recordSharedResolutionFromLoad(pkgName, extraOptions, result, 'async');
    publishRuntimeDebugUpdate('shared-resolution');
    return result;
  } catch (error) {
    if (isModuleFederationErrorCode(error, 'MFV-003')) {
      publishRuntimeDebugUpdate('shared-resolution');
      throw error;
    }

    recordSharedResolutionError(pkgName, extraOptions, error);
    publishRuntimeDebugUpdate('shared-resolution');
    throw error;
  }
}

export function loadShareSync<T>(...args: Parameters<ModuleFederation['loadShareSync']>) {
  const [pkgName, extraOptions] = args;

  try {
    const result = loadRuntimeShareSync<T>(...args);
    recordSharedResolutionFromLoad(pkgName, extraOptions, result, 'sync');
    publishRuntimeDebugUpdate('shared-resolution');
    return result;
  } catch (error) {
    if (isModuleFederationErrorCode(error, 'MFV-003')) {
      publishRuntimeDebugUpdate('shared-resolution');
      throw error;
    }

    recordSharedResolutionError(pkgName, extraOptions, error);
    publishRuntimeDebugUpdate('shared-resolution');
    throw error;
  }
}

export async function loadRemote<T>(...args: Parameters<ModuleFederation['loadRemote']>) {
  const [remoteId] = args;
  const debugState = getRuntimeDebugState();

  try {
    const result = await loadRuntimeRemote<T>(...args);
    debugState.lastLoadRemote = {
      remoteId,
      timestamp: new Date().toISOString(),
    };
    publishRuntimeDebugUpdate('load-remote');
    return result;
  } catch (error) {
    debugState.lastLoadError = {
      code: 'MFV-004',
      message: error instanceof Error ? error.message : String(error),
      remoteId,
      timestamp: new Date().toISOString(),
    };
    publishRuntimeDebugUpdate('load-error');
    throw error;
  }
}

export function preloadRemote(...args: Parameters<ModuleFederation['preloadRemote']>) {
  const debugState = getRuntimeDebugState();
  debugState.lastPreloadRemote = [...args];
  return preloadRuntimeRemote(...args);
}

function getDefaultTarget(target?: FederationRuntimeTarget): FederationRuntimeTarget {
  if (target) return target;
  return typeof (globalThis as { window?: unknown }).window === 'undefined' ? 'node' : 'web';
}

function getManifestRequestKey(
  remoteAlias: string,
  manifestUrl: string,
  target: FederationRuntimeTarget,
) {
  return `${target}:${remoteAlias}:${manifestUrl}`;
}

function getManifestFetchImplementation(fetchOverride?: typeof fetch) {
  const fetchImplementation = fetchOverride ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw createModuleFederationError(
      'MFV-004',
      'global fetch is unavailable. Provide `options.fetch` when registering manifest remotes.',
    );
  }
  return fetchImplementation;
}

function isAbsoluteUrl(value: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value) || value.startsWith('//');
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '');
}

function joinUrlPath(...parts: Array<string | undefined>) {
  const filteredParts = parts
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .map((part) => trimSlashes(part));
  return filteredParts.join('/');
}

function resolveManifestAssetUrl(
  manifestUrl: string,
  entry: FederationRemoteManifestEntry,
  publicPath?: string,
) {
  const entryPath = joinUrlPath(entry.path, entry.name);
  if (!entryPath) {
    return manifestUrl;
  }
  if (isAbsoluteUrl(entryPath)) {
    return entryPath;
  }
  if (publicPath && publicPath !== 'auto') {
    return new URL(entryPath, new URL(publicPath, manifestUrl)).toString();
  }
  return new URL(entryPath, manifestUrl).toString();
}

export function resolveFederationManifestAssetUrl(
  manifestUrl: string,
  manifest: Pick<FederationRemoteManifest, 'metaData'>,
  assetPath: string,
) {
  if (isAbsoluteUrl(assetPath)) {
    return assetPath;
  }

  const publicPath = manifest.metaData?.publicPath;
  if (publicPath && publicPath !== 'auto') {
    return new URL(assetPath, new URL(publicPath, manifestUrl)).toString();
  }

  return new URL(assetPath, manifestUrl).toString();
}

function normalizeExposePath(exposePath: string) {
  return exposePath.startsWith('./') ? exposePath : `./${exposePath}`;
}

function normalizeExposeName(exposePath: string) {
  return exposePath.replace(/^\.\//, '');
}

export function findFederationManifestExpose(
  manifest: Pick<FederationRemoteManifest, 'exposes'>,
  exposePath: string,
) {
  if (!Array.isArray(manifest.exposes)) {
    return undefined;
  }

  const normalizedPath = normalizeExposePath(exposePath);
  const normalizedName = normalizeExposeName(exposePath);

  return manifest.exposes.find((expose) => {
    return (
      expose?.path === exposePath ||
      expose?.path === normalizedPath ||
      expose?.name === exposePath ||
      expose?.name === normalizedName
    );
  });
}

function resolveManifestAssetGroup(
  manifestUrl: string,
  manifest: Pick<FederationRemoteManifest, 'metaData'>,
  group: FederationManifestAssetGroup | undefined,
) {
  const sync = (group?.sync || []).map((asset) =>
    resolveFederationManifestAssetUrl(manifestUrl, manifest, asset),
  );
  const async = (group?.async || []).map((asset) =>
    resolveFederationManifestAssetUrl(manifestUrl, manifest, asset),
  );

  return {
    all: [...sync, ...async],
    async,
    sync,
  };
}

export function collectFederationManifestExposeAssets(
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  exposePath: string,
): FederationManifestResolvedExposeAssets {
  const expose = findFederationManifestExpose(manifest, exposePath);
  if (!expose) {
    throw createModuleFederationError(
      'MFV-005',
      `Unable to find expose "${exposePath}" in federation manifest "${manifestUrl}".`,
    );
  }

  return {
    css: resolveManifestAssetGroup(manifestUrl, manifest, expose.assets?.css),
    expose,
    js: resolveManifestAssetGroup(manifestUrl, manifest, expose.assets?.js),
  };
}

function normalizePreloadCrossorigin(
  crossorigin: CollectFederationManifestPreloadLinksOptions['crossorigin'],
): FederationManifestPreloadLink['crossorigin'] {
  if (crossorigin === false) {
    return undefined;
  }
  if (crossorigin === 'use-credentials') {
    return crossorigin;
  }
  return 'anonymous';
}

function pushFederationManifestPreloadLink(
  links: FederationManifestPreloadLink[],
  seen: Set<string>,
  link: FederationManifestPreloadLink,
) {
  const key = `${link.rel}:${link.href}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  links.push(link);
}

export function collectFederationManifestPreloadLinks(
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  exposePaths: string | string[],
  options: CollectFederationManifestPreloadLinksOptions = {},
): FederationManifestPreloadLink[] {
  const links: FederationManifestPreloadLink[] = [];
  const seen = new Set<string>();
  const normalizedExposePaths = Array.isArray(exposePaths) ? exposePaths : [exposePaths];
  const includeCss = options.includeCss !== false;
  const includeJs = options.includeJs !== false;
  const includeAsyncCss = options.includeAsyncCss !== false;
  const includeAsyncJs = options.includeAsyncJs === true;
  const crossorigin = normalizePreloadCrossorigin(options.crossorigin);

  for (const exposePath of normalizedExposePaths) {
    const assets = collectFederationManifestExposeAssets(manifestUrl, manifest, exposePath);

    if (includeCss) {
      for (const href of assets.css.sync) {
        pushFederationManifestPreloadLink(links, seen, {
          assetType: 'css',
          expose: assets.expose,
          exposePath,
          href,
          loading: 'sync',
          rel: 'stylesheet',
        });
      }
      if (includeAsyncCss) {
        for (const href of assets.css.async) {
          pushFederationManifestPreloadLink(links, seen, {
            assetType: 'css',
            expose: assets.expose,
            exposePath,
            href,
            loading: 'async',
            rel: 'stylesheet',
          });
        }
      }
    }

    if (includeJs) {
      for (const href of assets.js.sync) {
        pushFederationManifestPreloadLink(links, seen, {
          assetType: 'js',
          ...(crossorigin ? { crossorigin } : {}),
          expose: assets.expose,
          exposePath,
          href,
          loading: 'sync',
          rel: 'modulepreload',
        });
      }
      if (includeAsyncJs) {
        for (const href of assets.js.async) {
          pushFederationManifestPreloadLink(links, seen, {
            assetType: 'js',
            ...(crossorigin ? { crossorigin } : {}),
            expose: assets.expose,
            exposePath,
            href,
            loading: 'async',
            rel: 'modulepreload',
          });
        }
      }
    }
  }

  return links;
}

function appendEntryRefreshTimestamp(
  entryUrl: string,
  target: FederationRuntimeTarget,
  enabled: boolean | undefined,
) {
  if (!enabled || target !== 'web') {
    return entryUrl;
  }

  const refreshedUrl = new URL(entryUrl);
  refreshedUrl.searchParams.set('t', String(Date.now()));
  return refreshedUrl.toString();
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOptionalStringField(manifestUrl: string, fieldPath: string, value: unknown) {
  if (typeof value === 'undefined') {
    return;
  }

  if (typeof value !== 'string') {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: ${fieldPath} must be a string when provided.`,
    );
  }
}

function assertOptionalObjectField(manifestUrl: string, fieldPath: string, value: unknown) {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (!isObjectRecord(value)) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: ${fieldPath} must be an object when provided.`,
    );
  }

  return value;
}

function validateManifestEntryField(
  manifestUrl: string,
  fieldPath: string,
  entry: unknown,
): asserts entry is FederationRemoteManifestEntry | undefined {
  if (typeof entry === 'undefined') {
    return;
  }

  if (!isObjectRecord(entry)) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: ${fieldPath} must be an object when provided.`,
    );
  }

  assertOptionalStringField(manifestUrl, `${fieldPath}.name`, entry.name);
  assertOptionalStringField(manifestUrl, `${fieldPath}.path`, entry.path);
  assertOptionalStringField(manifestUrl, `${fieldPath}.type`, entry.type);
  assertOptionalStringField(manifestUrl, `${fieldPath}.integrity`, entry.integrity);
  assertOptionalStringField(manifestUrl, `${fieldPath}.contentHash`, entry.contentHash);
}

function isUsableManifestEntry(
  entry: FederationRemoteManifestEntry | undefined,
): entry is FederationRemoteManifestEntry & { name: string } {
  return typeof entry?.name === 'string' && entry.name.length > 0;
}

function assertUsableManifestEntryForTarget(
  manifestUrl: string,
  target: FederationRuntimeTarget,
  entry: FederationRemoteManifestEntry | undefined,
  errorCode: ModuleFederationErrorCode,
  description: string,
) {
  if (isUsableManifestEntry(entry)) {
    return entry;
  }

  throw createModuleFederationError(
    errorCode,
    `Federation manifest "${manifestUrl}" does not declare a usable ${description} for target "${target}".`,
  );
}

function getManifestEntryForTarget(
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  target: FederationRuntimeTarget,
) {
  const { metaData } = manifest;
  if (!metaData) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: missing metaData.`,
    );
  }

  if (target === 'node') {
    const nodeEntry = metaData.ssrRemoteEntry || metaData.remoteEntry;
    return assertUsableManifestEntryForTarget(
      manifestUrl,
      target,
      nodeEntry,
      'MFV-006',
      'ssrRemoteEntry or remoteEntry fallback',
    );
  }

  const browserEntry = metaData.remoteEntry || metaData.ssrRemoteEntry;
  return assertUsableManifestEntryForTarget(
    manifestUrl,
    target,
    browserEntry,
    'MFV-004',
    'remoteEntry or ssrRemoteEntry fallback',
  );
}

function validateManifest(manifestUrl: string, manifest: FederationRemoteManifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: expected a JSON object.`,
    );
  }

  assertSupportedFederationManifestSchemaVersion(manifestUrl, manifest.schemaVersion);

  if (typeof manifest.name !== 'string' || !manifest.name || !manifest.metaData) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: missing name or metaData.`,
    );
  }

  if (!isObjectRecord(manifest.metaData)) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" is invalid: metaData must be an object.`,
    );
  }

  assertOptionalStringField(manifestUrl, 'id', manifest.id);
  const release = assertOptionalObjectField(manifestUrl, 'release', manifest.release);
  assertOptionalStringField(manifestUrl, 'release.id', release?.id);
  assertOptionalStringField(manifestUrl, 'release.buildName', release?.buildName);
  assertOptionalStringField(manifestUrl, 'release.buildVersion', release?.buildVersion);
  assertOptionalStringField(manifestUrl, 'metaData.name', manifest.metaData.name);
  assertOptionalStringField(manifestUrl, 'metaData.globalName', manifest.metaData.globalName);
  assertOptionalStringField(manifestUrl, 'metaData.publicPath', manifest.metaData.publicPath);
  const buildInfo = assertOptionalObjectField(
    manifestUrl,
    'metaData.buildInfo',
    manifest.metaData.buildInfo,
  );
  assertOptionalStringField(manifestUrl, 'metaData.buildInfo.buildName', buildInfo?.buildName);
  assertOptionalStringField(
    manifestUrl,
    'metaData.buildInfo.buildVersion',
    buildInfo?.buildVersion,
  );
  assertOptionalStringField(manifestUrl, 'metaData.buildInfo.releaseId', buildInfo?.releaseId);
  validateManifestEntryField(manifestUrl, 'metaData.remoteEntry', manifest.metaData.remoteEntry);
  validateManifestEntryField(
    manifestUrl,
    'metaData.ssrRemoteEntry',
    manifest.metaData.ssrRemoteEntry,
  );
}

function isManifestCacheEnabled(options: ManifestFetchOptions) {
  return options.cache !== false && options.cacheTtl !== 0;
}

function getManifestCacheExpiry(options: ManifestFetchOptions) {
  if (typeof options.cacheTtl !== 'number') {
    return null;
  }
  return Date.now() + Math.max(0, options.cacheTtl);
}

function isManifestCacheEntryFresh(entry: ManifestCacheEntry) {
  return entry.expiresAt === null || entry.expiresAt > Date.now();
}

function recordManifestFetch(entry: ManifestFetchLogEntry) {
  const debugState = getRuntimeDebugState();
  debugState.manifestFetches.push(entry);
  if (debugState.manifestFetches.length > 50) {
    debugState.manifestFetches.shift();
  }
}

function getManifestRetryDelay(options: ManifestFetchOptions, attempt: number, error: unknown) {
  if (typeof options.retryDelay === 'function') {
    return Math.max(0, options.retryDelay(attempt, error));
  }
  if (typeof options.retryDelay === 'number') {
    return Math.max(0, options.retryDelay);
  }
  return Math.min(1000, 100 * 2 ** attempt);
}

function wait(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getManifestFetchErrorStatus(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function markManifestFetchError<T extends Error>(
  error: T,
  metadata: { retriable?: boolean; status?: number },
) {
  const target = error as T & { retriable?: boolean; status?: number };
  if (typeof metadata.status === 'number') target.status = metadata.status;
  if (typeof metadata.retriable === 'boolean') target.retriable = metadata.retriable;
  return target;
}

function isRetriableManifestFetchError(error: unknown) {
  const explicitRetriable = (error as { retriable?: unknown } | null)?.retriable;
  if (typeof explicitRetriable === 'boolean') {
    return explicitRetriable;
  }

  const status = getManifestFetchErrorStatus(error);
  if (typeof status === 'number') {
    return status === 408 || status === 429 || status >= 500;
  }

  return true;
}

function toManifestFetchError(manifestUrl: string, error: unknown) {
  if (error instanceof Error && (error as { code?: string }).code === 'MFV-004') {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return createModuleFederationError(
    'MFV-004',
    `Failed to fetch federation manifest "${manifestUrl}": ${message}`,
  );
}

async function fetchManifestResponse(
  manifestUrl: string,
  fetchImplementation: typeof fetch,
  options: ManifestFetchOptions,
) {
  if (!options.timeout || options.timeout <= 0 || typeof AbortController === 'undefined') {
    return fetchImplementation(manifestUrl, options.fetchInit);
  }

  const controller = new AbortController();
  const fetchInit = options.fetchInit ? { ...options.fetchInit } : {};
  const externalSignal = fetchInit.signal;
  let didTimeout = false;

  const onAbort = () => {
    controller.abort(externalSignal?.reason);
  };
  if (externalSignal?.aborted) {
    onAbort();
  } else {
    externalSignal?.addEventListener('abort', onAbort, { once: true });
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(
        markManifestFetchError(
          createModuleFederationError(
            'MFV-004',
            `Timed out fetching federation manifest "${manifestUrl}" after ${options.timeout}ms.`,
          ),
          { retriable: true },
        ),
      );
    }, options.timeout);
  });

  try {
    return await Promise.race([
      fetchImplementation(manifestUrl, {
        ...fetchInit,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (didTimeout) {
      throw markManifestFetchError(
        createModuleFederationError(
          'MFV-004',
          `Timed out fetching federation manifest "${manifestUrl}" after ${options.timeout}ms.`,
        ),
        { retriable: true },
      );
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

async function fetchManifestJsonWithRetries(manifestUrl: string, options: ManifestFetchOptions) {
  const fetchImplementation = getManifestFetchImplementation(options.fetch);
  const maxRetries = Math.max(0, Math.floor(options.retries || 0));
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const startedAt = Date.now();

    try {
      const response = await fetchManifestResponse(manifestUrl, fetchImplementation, options);
      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        throw markManifestFetchError(
          createModuleFederationError(
            'MFV-004',
            `Failed to fetch federation manifest "${manifestUrl}" with status ${response.status}.`,
          ),
          {
            retriable: response.status === 408 || response.status === 429 || response.status >= 500,
            status: response.status,
          },
        );
      }

      const manifest = (await response.json()) as FederationRemoteManifest;
      validateManifest(manifestUrl, manifest);
      recordManifestFetch({
        attempt,
        durationMs,
        manifestUrl,
        status: 'success',
        statusCode: response.status,
        timestamp: new Date().toISOString(),
      });
      return manifest;
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxRetries && isRetriableManifestFetchError(error);
      recordManifestFetch({
        attempt,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        manifestUrl,
        status: shouldRetry ? 'retry' : 'failure',
        statusCode: getManifestFetchErrorStatus(error),
        timestamp: new Date().toISOString(),
      });

      if (!shouldRetry) {
        break;
      }

      await wait(getManifestRetryDelay(options, attempt, error));
    }
  }

  throw toManifestFetchError(manifestUrl, lastError);
}

export async function fetchFederationManifest(
  manifestUrl: string,
  options: ManifestFetchOptions = {},
) {
  const debugState = getRuntimeDebugState();
  if (options.force) {
    debugState.manifestCache.delete(manifestUrl);
    debugState.manifestRequests.delete(manifestUrl);
  }

  const cachedManifest = debugState.manifestCache.get(manifestUrl);
  if (
    cachedManifest &&
    !options.force &&
    isManifestCacheEnabled(options) &&
    isManifestCacheEntryFresh(cachedManifest)
  ) {
    recordManifestFetch({
      attempt: 0,
      manifestUrl,
      status: 'cache-hit',
      timestamp: new Date().toISOString(),
    });
    return cachedManifest.manifest;
  }

  if (cachedManifest && !isManifestCacheEntryFresh(cachedManifest)) {
    debugState.manifestCache.delete(manifestUrl);
  }

  const pendingManifest = debugState.manifestRequests.get(manifestUrl);
  if (pendingManifest && !options.force) {
    return pendingManifest;
  }

  const fetchManifestPromise = (async () => {
    try {
      const manifest = await fetchManifestJsonWithRetries(manifestUrl, options);
      if (isManifestCacheEnabled(options)) {
        debugState.manifestCache.set(manifestUrl, {
          expiresAt: getManifestCacheExpiry(options),
          fetchedAt: Date.now(),
          manifest,
        });
      }
      publishRuntimeDebugUpdate('manifest-fetched');
      return manifest;
    } catch (error) {
      const manifestError = toManifestFetchError(manifestUrl, error);
      debugState.lastLoadError = {
        code: 'MFV-004',
        message: manifestError.message,
        remoteId: manifestUrl,
        timestamp: new Date().toISOString(),
      };
      throw manifestError;
    } finally {
      debugState.manifestRequests.delete(manifestUrl);
    }
  })();

  debugState.manifestRequests.set(manifestUrl, fetchManifestPromise);
  return fetchManifestPromise;
}

export async function registerManifestRemote(
  remoteAlias: string,
  manifestUrl: string,
  options: RegisterManifestRemoteOptions = {},
) {
  const debugState = getRuntimeDebugState();
  const target = getDefaultTarget(options.target);
  const requestKey = getManifestRequestKey(remoteAlias, manifestUrl, target);

  if (!options.force) {
    const pendingRegistration = debugState.registrationRequests.get(requestKey);
    if (pendingRegistration) {
      return pendingRegistration;
    }
  }

  const registerPromise = (async () => {
    const manifest = await fetchFederationManifest(manifestUrl, options);
    const selectedEntry = getManifestEntryForTarget(manifestUrl, manifest, target);
    const remoteName = options.remoteName || manifest.name || remoteAlias;
    const shareScope = options.shareScope || 'default';
    const remoteEntryUrl = resolveManifestAssetUrl(
      manifestUrl,
      selectedEntry,
      manifest.metaData.publicPath,
    );
    const registration = {
      alias: remoteAlias === remoteName ? undefined : remoteAlias,
      entry: appendEntryRefreshTimestamp(remoteEntryUrl, target, options.force),
      entryGlobalName: manifest.metaData.globalName || remoteName,
      name: remoteName,
      shareScope,
      type: selectedEntry.type || 'module',
    };

    registerRuntimeRemoteWithReplace(registration, {
      force: options.force,
      remoteIdentifier: remoteAlias,
    });

    debugState.registeredManifestRemotes.set(requestKey, {
      alias: remoteAlias,
      entry: registration.entry,
      entryGlobalName: registration.entryGlobalName,
      manifestUrl,
      name: registration.name,
      shareScope: registration.shareScope,
      target,
      type: registration.type,
    });
    publishRuntimeDebugUpdate('manifest-registered');

    return registration;
  })().finally(() => {
    debugState.registrationRequests.delete(requestKey);
  });

  debugState.registrationRequests.set(requestKey, registerPromise);
  return registerPromise;
}

export interface RefreshRemoteOptions extends RegisterManifestRemoteOptions {
  invalidateManifest?: boolean;
  manifestUrl?: string;
}

function getRegisteredManifestRemote(remoteAlias: string, target: FederationRuntimeTarget) {
  const debugState = getRuntimeDebugState();
  return [...debugState.registeredManifestRemotes.entries()].find(([, remote]) => {
    return remote.alias === remoteAlias && remote.target === target;
  });
}

function getRegisteredRuntimeRemote(remoteAlias: string) {
  const runtimeInstance = getRuntimeInstance() as RuntimeInstanceWithInternals | null;
  const remotes = runtimeInstance?.options?.remotes;

  if (!Array.isArray(remotes)) {
    return undefined;
  }

  return remotes.find((remote) => {
    return remote?.name === remoteAlias || remote?.alias === remoteAlias;
  });
}

function isManifestRemoteEntry(entry: unknown) {
  return typeof entry === 'string' && MANIFEST_URL_RE.test(entry);
}

export async function refreshRemote(remoteIdOrAlias: string, options: RefreshRemoteOptions = {}) {
  const remoteAlias = remoteIdOrAlias.split('/')[0];
  if (!remoteAlias) {
    throw createModuleFederationError('MFV-004', `Invalid remote id "${remoteIdOrAlias}".`);
  }

  const target = getDefaultTarget(options.target);
  const registeredManifestRemote = getRegisteredManifestRemote(remoteAlias, target);
  const manifestUrl = options.manifestUrl || registeredManifestRemote?.[1].manifestUrl;

  if (manifestUrl) {
    const debugState = getRuntimeDebugState();
    const requestKey =
      registeredManifestRemote?.[0] || getManifestRequestKey(remoteAlias, manifestUrl, target);

    if (options.invalidateManifest !== false) {
      debugState.manifestCache.delete(manifestUrl);
    }
    debugState.manifestRequests.delete(manifestUrl);
    debugState.registrationRequests.delete(requestKey);
    debugState.registeredManifestRemotes.delete(requestKey);

    const registration = await registerManifestRemote(remoteAlias, manifestUrl, {
      ...options,
      force: true,
      remoteName: options.remoteName || registeredManifestRemote?.[1].name,
      shareScope: options.shareScope || registeredManifestRemote?.[1].shareScope,
      target,
    });

    syncRegisteredRemoteDebugState();
    publishRuntimeDebugUpdate('refresh-remote');
    return registration;
  }

  const runtimeRemote = getRegisteredRuntimeRemote(remoteAlias);
  if (!runtimeRemote) {
    throw createModuleFederationError(
      'MFV-004',
      `Remote "${remoteAlias}" is not registered in the current federation runtime instance.`,
    );
  }

  const runtimeRemoteRecord = runtimeRemote as unknown as Record<string, unknown>;
  const runtimeRemoteEntry =
    typeof runtimeRemoteRecord.entry === 'string' ? runtimeRemoteRecord.entry : undefined;

  if (runtimeRemoteEntry && isManifestRemoteEntry(runtimeRemoteEntry)) {
    const registration = await registerManifestRemote(remoteAlias, runtimeRemoteEntry, {
      ...options,
      force: true,
      remoteName:
        typeof runtimeRemoteRecord.name === 'string'
          ? (runtimeRemoteRecord.name as string)
          : options.remoteName,
      shareScope:
        typeof runtimeRemoteRecord.shareScope === 'string'
          ? (runtimeRemoteRecord.shareScope as string)
          : options.shareScope,
      target,
    });

    syncRegisteredRemoteDebugState();
    publishRuntimeDebugUpdate('refresh-remote');
    return registration;
  }

  const refreshedRuntimeRemote = {
    ...runtimeRemoteRecord,
    ...(typeof runtimeRemoteRecord.entry === 'string'
      ? {
          entry: appendEntryRefreshTimestamp(runtimeRemoteRecord.entry, target, true),
        }
      : {}),
  } as Parameters<ModuleFederation['registerRemotes']>[0][number];

  registerRuntimeRemoteWithReplace(refreshedRuntimeRemote, {
    force: true,
    remoteIdentifier: remoteAlias,
  });
  syncRegisteredRemoteDebugState();
  publishRuntimeDebugUpdate('refresh-remote');
  return runtimeRemote;
}

export async function registerManifestRemotes(
  remotes: Record<string, string | (RegisterManifestRemoteOptions & { manifestUrl: string })>,
  target?: FederationRuntimeTarget,
) {
  const registrations = await Promise.all(
    Object.entries(remotes).map(([remoteAlias, remoteConfig]) => {
      if (typeof remoteConfig === 'string') {
        return registerManifestRemote(remoteAlias, remoteConfig, { target });
      }
      return registerManifestRemote(remoteAlias, remoteConfig.manifestUrl, {
        ...remoteConfig,
        target: remoteConfig.target || target,
      });
    }),
  );

  return registrations;
}

export async function loadRemoteFromManifest<T>(
  remoteId: string,
  manifestUrl: string,
  options: RegisterManifestRemoteOptions &
    Partial<NonNullable<Parameters<ModuleFederation['loadRemote']>[1]>> = {},
) {
  const [remoteAlias] = remoteId.split('/');
  if (!remoteAlias) {
    throw createModuleFederationError('MFV-004', `Invalid remote id "${remoteId}".`);
  }

  const {
    cache,
    cacheTtl,
    fetch,
    fetchInit,
    force,
    remoteName,
    retries,
    retryDelay,
    shareScope,
    target,
    timeout,
    ...loadRemoteOptions
  } = options;

  await registerManifestRemote(remoteAlias, manifestUrl, {
    cache,
    cacheTtl,
    fetch,
    fetchInit,
    force,
    remoteName,
    retries,
    retryDelay,
    shareScope,
    target,
    timeout,
  });

  const runtimeLoadOptions = {
    from: 'runtime',
    ...loadRemoteOptions,
  } as Parameters<ModuleFederation['loadRemote']>[1];

  return loadRemote<T>(remoteId, runtimeLoadOptions);
}

export function clearFederationRuntimeCaches() {
  const debugState = getRuntimeDebugState();
  nodeRuntimeModuleCache.clear();
  debugState.lastLoadError = null;
  debugState.lastLoadRemote = null;
  debugState.lastPreloadRemote = null;
  debugState.registeredRemotes = [];
  debugState.registeredShared = [];
  debugState.registeredSharedKeys = [];
  debugState.sharedResolutionGraph = [];
  debugState.sharedResolutionSeq = 0;
  debugState.manifestCache.clear();
  debugState.manifestFetches = [];
  debugState.manifestRequests.clear();
  debugState.registrationRequests.clear();
  debugState.registeredManifestRemotes.clear();
  publishRuntimeDebugUpdate('clear-caches');
}

export function getFederationDebugInfo() {
  const debugState = getRuntimeDebugState();

  return {
    diagnostics: getModuleFederationDebugState(),
    instance: snapshotInstance(getRuntimeInstance()),
    runtime: {
      lastLoadError: debugState.lastLoadError,
      lastLoadRemote: debugState.lastLoadRemote,
      lastPreloadRemote: debugState.lastPreloadRemote,
      manifestCache: [...debugState.manifestCache.entries()].map(([manifestUrl, entry]) => ({
        expiresAt: entry.expiresAt,
        fetchedAt: entry.fetchedAt,
        manifestUrl,
        name: entry.manifest.name,
      })),
      manifestCacheKeys: [...debugState.manifestCache.keys()],
      manifestFetches: debugState.manifestFetches.map((entry) => ({ ...entry })),
      pendingManifestRequests: [...debugState.manifestRequests.keys()],
      pendingRemoteRegistrations: [...debugState.registrationRequests.keys()],
      registeredManifestRemotes: [...debugState.registeredManifestRemotes.values()].map(
        (remote) => ({ ...remote }),
      ),
      registeredRemotes: debugState.registeredRemotes.map((remote) => ({ ...remote })),
      registeredShared: debugState.registeredShared.map((shared) => ({
        ...shared,
        versions: shared.versions.map((version) => ({ ...version })),
      })),
      registeredSharedKeys: [...debugState.registeredSharedKeys],
      shareScope: snapshotShareScopeMap(
        (getRuntimeInstance() as RuntimeInstanceWithInternals | null)?.shareScopeMap,
      ).map((shared) => ({
        ...shared,
        versions: shared.versions.map((version) => ({ ...version })),
      })),
      sharedResolutionGraph: debugState.sharedResolutionGraph.map((entry) => ({
        ...entry,
        candidates: entry.candidates.map((candidate) => ({ ...candidate })),
        rejected: entry.rejected.map((candidate) => ({ ...candidate })),
        selected: entry.selected ? { ...entry.selected } : null,
      })),
    },
  };
}

function publishRuntimeDebugUpdate(event: RuntimeDebugEventName) {
  const payload = {
    event,
    snapshot: getFederationDebugInfo(),
    timestamp: new Date().toISOString(),
  };

  const devtoolsGlobal = getDevtoolsGlobal();
  devtoolsGlobal.runtime = payload.snapshot;
  devtoolsGlobal.events ||= [];
  devtoolsGlobal.events.push(payload);
  if (devtoolsGlobal.events.length > 20) {
    devtoolsGlobal.events.shift();
  }
  devtoolsGlobal.lastUpdatedAt = payload.timestamp;

  const browserWindow = (globalThis as { window?: { dispatchEvent?: (event: unknown) => void } })
    .window;
  const CustomEventCtor = (
    globalThis as { CustomEvent?: new (type: string, init?: { detail?: unknown }) => unknown }
  ).CustomEvent;
  if (browserWindow?.dispatchEvent && typeof CustomEventCtor === 'function') {
    browserWindow.dispatchEvent(
      new CustomEventCtor('vite-plugin-federation:debug', {
        detail: payload,
      }),
    );
  }
}
