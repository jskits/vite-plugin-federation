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
const SHARED_RESOLUTION_RECORDER_SYMBOL = Symbol.for(
  'vite-plugin-federation.runtime.recordSharedResolution',
);
const NODE_TARGET_QUERY_KEY = 'mf_target';
const NODE_TARGET_QUERY_VALUE = 'node';
const STYLE_REQUEST_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss)$/i;
const NODE_RUNTIME_ENTRY_LOADER_PLUGIN_NAME = 'vite-plugin-federation:node-entry-loader';
const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const NODE_VM_IMPORT_GLOBAL_KEY = '__VITE_PLUGIN_FEDERATION_IMPORT_NODE_VM__';
const MANIFEST_URL_RE = /(?:^|\/)(?:mf-)?manifest(?:\.[\w-]+)?\.json(?:$|[?#])/i;
const SHARED_DIAGNOSTICS_PLUGIN_NAME = 'vite-plugin-federation:shared-diagnostics';
const MAX_SHARED_RESOLUTION_EVENTS = 100;
const DEVTOOLS_CONTRACT_VERSION = '1.0.0';
const MAX_DEVTOOLS_EVENTS = 50;

export type FederationRuntimeTarget = 'web' | 'node';

export interface FederationRemoteManifestEntry {
  contentHash?: string;
  href?: string;
  integrity?: string;
  name?: string;
  path?: string;
  type?: string;
  url?: string;
}

export type FederationManifestAssetReference = string | FederationRemoteManifestEntry;

export interface FederationManifestAssetGroup {
  async?: FederationManifestAssetReference[];
  sync?: FederationManifestAssetReference[];
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

export interface FederationManifestPreloadHint {
  assets?: {
    css?: FederationManifestAssetReference[];
    js?: FederationManifestAssetReference[];
  };
  expose?: string;
  exposes?: string[];
  loading?: 'async' | 'sync';
  route?: string;
}

export interface FederationManifestPreloadHints {
  assets?: FederationManifestPreloadHint['assets'];
  routes?: FederationManifestPreloadHint[];
}

export interface CollectFederationManifestPreloadLinksOptions {
  crossorigin?: boolean | 'anonymous' | 'use-credentials';
  includeAsyncCss?: boolean;
  includeAsyncJs?: boolean;
  includeCss?: boolean;
  includeJs?: boolean;
}

export type FederationPreloadAsyncChunkPolicy = 'all' | 'css' | 'js' | 'none';

export interface FederationPreloadRouteConfig {
  exposes: string | string[];
  route: string;
}

export type FederationPreloadRoutes =
  | FederationPreloadRouteConfig[]
  | Record<string, string | string[] | { exposes: string | string[] }>;

export interface CreateFederationManifestPreloadPlanOptions extends CollectFederationManifestPreloadLinksOptions {
  asyncChunkPolicy?: FederationPreloadAsyncChunkPolicy;
  includeManifestHints?: boolean;
}

export interface FederationManifestPreloadPlanRoute {
  exposes: string[];
  links: FederationManifestPreloadLink[];
  route: string;
}

export interface FederationManifestPreloadPlan {
  links: FederationManifestPreloadLink[];
  manifestUrl: string;
  remoteName: string;
  routes: FederationManifestPreloadPlanRoute[];
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
  preload?: FederationManifestPreloadHints;
  shared?: unknown;
  [key: string]: unknown;
}

export interface ManifestFetchOptions {
  cache?: boolean;
  cacheTtl?: number;
  circuitBreaker?: boolean | ManifestCircuitBreakerOptions;
  fallbackUrls?: string[];
  fetch?: typeof fetch;
  fetchInit?: RequestInit;
  force?: boolean;
  hooks?: FederationRuntimeHooks;
  retries?: number;
  retryDelay?: number | ((attempt: number, error: unknown) => number);
  runtimeKey?: string;
  staleWhileRevalidate?: boolean;
  timeout?: number;
}

export interface ManifestCircuitBreakerOptions {
  cooldownMs?: number;
  failureThreshold?: number;
}

export type FederationRuntimeHookKind =
  | 'manifest-fetch'
  | 'remote-register'
  | 'remote-load'
  | 'remote-refresh';

export type FederationRuntimeHookStage = 'before' | 'after' | 'error';

export interface FederationRuntimeHookEvent {
  durationMs?: number;
  entry?: string;
  error?: string;
  kind: FederationRuntimeHookKind;
  manifestUrl?: string;
  primaryManifestUrl?: string;
  remoteAlias?: string;
  remoteId?: string;
  remoteName?: string;
  runtimeKey?: string;
  shareScope?: string;
  sourceUrl?: string;
  stage: FederationRuntimeHookStage;
  status?: string;
  statusCode?: number;
  target?: FederationRuntimeTarget;
  timestamp: string;
}

export interface FederationRuntimeHooks {
  manifestFetch?: (event: FederationRuntimeHookEvent) => void;
  remoteLoad?: (event: FederationRuntimeHookEvent) => void;
  remoteRefresh?: (event: FederationRuntimeHookEvent) => void;
  remoteRegister?: (event: FederationRuntimeHookEvent) => void;
  telemetry?: (event: FederationRuntimeHookEvent) => void;
}

export type ManifestIntegrityVerificationMode =
  | 'prefer-integrity'
  | 'integrity'
  | 'content-hash'
  | 'both';

export interface ManifestIntegrityOptions {
  mode?: ManifestIntegrityVerificationMode;
}

interface NormalizedManifestIntegrityOptions {
  mode: ManifestIntegrityVerificationMode;
}

export interface RegisterManifestRemoteOptions extends ManifestFetchOptions {
  integrity?: boolean | ManifestIntegrityOptions;
  remoteName?: string;
  shareScope?: string;
  target?: FederationRuntimeTarget;
}

interface ManifestCacheEntry {
  expiresAt: number | null;
  fetchedAt: number;
  manifestUrl: string;
  manifest: FederationRemoteManifest;
  runtimeKey: string;
  sourceUrl: string;
}

interface ManifestFetchLogEntry {
  attempt: number;
  durationMs?: number;
  error?: string;
  manifestUrl: string;
  primaryManifestUrl?: string;
  runtimeKey?: string;
  sourceUrl?: string;
  status: 'cache-hit' | 'circuit-open' | 'failure' | 'retry' | 'stale-cache-hit' | 'success';
  statusCode?: number;
  timestamp: string;
}

interface ManifestFetchResult {
  manifest: FederationRemoteManifest;
  sourceUrl: string;
}

interface ManifestIntegrityCheckLogEntry {
  actualContentHash?: string;
  actualIntegrity?: string;
  assetUrl: string;
  error?: string;
  expectedContentHash?: string;
  expectedIntegrity?: string;
  manifestUrl: string;
  mode: ManifestIntegrityVerificationMode;
  status: 'failure' | 'success';
  target: FederationRuntimeTarget;
  timestamp: string;
  verifiedWith: Array<'contentHash' | 'integrity'>;
}

interface RemoteLoadMetricLogEntry {
  durationMs: number;
  entry?: string;
  error?: string;
  loadDurationMs?: number;
  manifestUrl?: string;
  phase: 'load' | 'register';
  registrationDurationMs?: number;
  remoteAlias?: string;
  remoteId: string;
  remoteName?: string;
  runtimeKey?: string;
  shareScope?: string;
  sourceUrl?: string;
  status: 'failure' | 'success';
  target?: FederationRuntimeTarget;
  timestamp: string;
}

export interface WarmFederationRemoteConfig extends RegisterManifestRemoteOptions {
  manifestUrl: string;
  preload?: boolean | Record<string, unknown>;
  remoteAlias?: string;
}

export interface VerifyFederationManifestAssetsOptions extends ManifestFetchOptions {
  includeExposes?: boolean;
  includePreloadHints?: boolean;
  integrity?: boolean | ManifestIntegrityOptions;
  requireIntegrity?: boolean;
  target?: FederationRuntimeTarget;
}

export interface VerifyFederationManifestAssetsResult {
  checked: number;
  skipped: number;
  verifiedAssets: string[];
}

interface ManifestCircuitBreakerState {
  failureCount: number;
  lastFailureAt: number | null;
  manifestUrl: string;
  nextRetryAt: number | null;
  openedAt: number | null;
  runtimeKey: string;
  state: 'closed' | 'open';
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
    entry?: string;
    manifestUrl?: string;
    message: string;
    remoteAlias?: string;
    remoteId: string;
    remoteName?: string;
    runtimeKey?: string;
    shareScope?: string;
    target?: FederationRuntimeTarget;
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
  manifestCircuitBreakers: Map<string, ManifestCircuitBreakerState>;
  manifestFetches: ManifestFetchLogEntry[];
  manifestIntegrityChecks: ManifestIntegrityCheckLogEntry[];
  manifestRequests: Map<string, Promise<FederationRemoteManifest>>;
  manifestSourceUrls: Map<string, string>;
  remoteLoadMetrics: RemoteLoadMetricLogEntry[];
  registrationRequests: Map<string, Promise<Record<string, unknown>>>;
  registeredManifestRemotes: Map<
    string,
    {
      alias: string;
      entry: string;
      entryGlobalName: string;
      manifestUrl: string;
      name: string;
      runtimeKey: string;
      shareScope: string;
      sourceUrl?: string;
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
    allowNodeModulesSuffixMatch?: unknown;
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

type RuntimeSharedOptionMatch = {
  candidateKey: string | null;
  matchType: SharedMatchType;
  shared: RuntimeSharedLike | undefined;
};

type RuntimeSharedResolutionRecorderPayload = {
  error?: unknown;
  extraOptions: unknown;
  mode: 'async' | 'sync';
  pkgName: string;
  result?: unknown;
  runtime: RuntimeInstanceWithInternals | null;
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
  | 'manifest-integrity'
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
    manifestCircuitBreakers: new Map(),
    manifestFetches: [],
    manifestIntegrityChecks: [],
    manifestRequests: new Map(),
    manifestSourceUrls: new Map(),
    remoteLoadMetrics: [],
    registrationRequests: new Map(),
    registeredManifestRemotes: new Map(),
  };

  return state[MODULE_FEDERATION_RUNTIME_DEBUG_SYMBOL];
}

function installSharedResolutionRecorder() {
  const state = globalThis as typeof globalThis & {
    [SHARED_RESOLUTION_RECORDER_SYMBOL]?: (payload: RuntimeSharedResolutionRecorderPayload) => void;
  };

  state[SHARED_RESOLUTION_RECORDER_SYMBOL] = (payload) => {
    if (payload.error !== undefined) {
      recordSharedResolutionError(
        payload.pkgName,
        payload.extraOptions,
        payload.error,
        payload.runtime,
      );
    } else {
      recordSharedResolutionFromLoad(
        payload.pkgName,
        payload.extraOptions,
        payload.result,
        payload.mode,
        payload.runtime,
      );
    }
    publishRuntimeDebugUpdate('shared-resolution');
  };
}

installSharedResolutionRecorder();

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

function getNormalizedPathSlashes(value: string) {
  return value.replace(/\\/g, '/');
}

function extractPackageRootFromNodeModulesPath(pkgName: string) {
  const normalized = getNormalizedPathSlashes(pkgName);
  const marker = '/node_modules/';
  const nodeModulesIndex = normalized.lastIndexOf(marker);
  if (nodeModulesIndex === -1) return null;

  const packagePath = normalized.slice(nodeModulesIndex + marker.length);
  if (!packagePath) return null;

  const segments = packagePath.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments[0].startsWith('@')) {
    return segments.length > 1 ? `${segments[0]}/${segments[1]}` : null;
  }
  return segments[0] || null;
}

function getSharedOptionValue(
  value: RuntimeSharedLike | RuntimeSharedLike[] | undefined,
): RuntimeSharedLike | undefined {
  return (Array.isArray(value) ? value[0] : value) as RuntimeSharedLike | undefined;
}

function matchRuntimeSharedOption(
  pkgName: string,
  sharedOptions?: RuntimeSharedOptionsLike,
): RuntimeSharedOptionMatch {
  if (!sharedOptions) {
    return {
      candidateKey: null,
      matchType: 'unknown',
      shared: undefined,
    };
  }

  if (Object.prototype.hasOwnProperty.call(sharedOptions, pkgName)) {
    return {
      candidateKey: pkgName,
      matchType: 'exact',
      shared: getSharedOptionValue(sharedOptions[pkgName]),
    };
  }

  const packageRoot = getPackageRootName(pkgName);
  if (packageRoot !== pkgName && Object.prototype.hasOwnProperty.call(sharedOptions, packageRoot)) {
    return {
      candidateKey: packageRoot,
      matchType: 'package-root',
      shared: getSharedOptionValue(sharedOptions[packageRoot]),
    };
  }

  const trailingSlashKey = `${packageRoot}/`;
  if (
    packageRoot !== pkgName &&
    Object.prototype.hasOwnProperty.call(sharedOptions, trailingSlashKey)
  ) {
    return {
      candidateKey: packageRoot,
      matchType: 'trailing-slash-subpath',
      shared: getSharedOptionValue(sharedOptions[trailingSlashKey]),
    };
  }

  const nodeModulesPackageRoot = extractPackageRootFromNodeModulesPath(pkgName);
  if (!nodeModulesPackageRoot) {
    return {
      candidateKey: null,
      matchType: 'unknown',
      shared: undefined,
    };
  }

  const suffixCandidates = [nodeModulesPackageRoot, `${nodeModulesPackageRoot}/`] as const;
  for (const key of suffixCandidates) {
    if (!Object.prototype.hasOwnProperty.call(sharedOptions, key)) continue;

    const shared = getSharedOptionValue(sharedOptions[key]);
    if (shared?.shareConfig?.allowNodeModulesSuffixMatch !== true) continue;

    return {
      candidateKey: nodeModulesPackageRoot,
      matchType: 'node-modules-suffix',
      shared,
    };
  }

  return {
    candidateKey: null,
    matchType: 'unknown',
    shared: undefined,
  };
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
  return matchRuntimeSharedOption(pkgName, sharedOptions).matchType;
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
  const candidateKeys = new Set<string>([pkgName]);
  const matchedSharedOption = matchRuntimeSharedOption(pkgName, runtimeInstance?.options?.shared);
  if (matchedSharedOption.candidateKey) {
    candidateKeys.add(matchedSharedOption.candidateKey);
  }
  const scopeNames = shareScopes?.length ? shareScopes : Object.keys(shareScopeMap);
  for (const scopeName of scopeNames) {
    for (const candidateKey of candidateKeys) {
      const versionMap = shareScopeMap[scopeName]?.[candidateKey];
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
  return getModuleFederationErrorCode(error) === code;
}

function getModuleFederationErrorCode(error: unknown): ModuleFederationErrorCode | undefined {
  const code = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined;
  if (
    code === 'MFV-001' ||
    code === 'MFV-002' ||
    code === 'MFV-003' ||
    code === 'MFV-004' ||
    code === 'MFV-005' ||
    code === 'MFV-006' ||
    code === 'MFV-007'
  ) {
    return code;
  }
  return undefined;
}

function getRuntimeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stripFormattedModuleFederationPrefix(message: string) {
  return message.replace(/^\[Module Federation\](?:\s+MFV-\d{3})?\s+/, '');
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
  const optionsShared = matchRuntimeSharedOption(pkgName, sharedOptions).shared;
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

function classifySharedResolutionError(
  shareConfig: RuntimeSharedLike['shareConfig'] | undefined,
  message: string,
) {
  const isHostOnlyConfigured = shareConfig?.import === false;
  const isHostOnlyMissingProvider =
    isHostOnlyConfigured &&
    /must be provided by (?:the )?host(?: because import: false is configured)?/i.test(message);

  if (isHostOnlyMissingProvider) {
    return {
      fallbackSource: 'host-only' as const,
      reason:
        'No registered host provider satisfied this import:false shared module; the consumer has no local fallback.',
      status: 'fallback' as const,
    };
  }

  return {
    fallbackSource: 'none' as const,
    reason: `Shared module resolution failed: ${message}`,
    status: 'error' as const,
  };
}

function recordSharedResolutionFromLoad(
  pkgName: string,
  extraOptions: unknown,
  result: unknown,
  mode: 'async' | 'sync',
  runtimeInstanceOverride?: RuntimeInstanceWithInternals | null,
) {
  const runtimeInstance =
    runtimeInstanceOverride ?? (getRuntimeInstance() as RuntimeInstanceWithInternals | null);
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

function recordSharedResolutionError(
  pkgName: string,
  extraOptions: unknown,
  error: unknown,
  runtimeInstanceOverride?: RuntimeInstanceWithInternals | null,
) {
  const runtimeInstance =
    runtimeInstanceOverride ?? (getRuntimeInstance() as RuntimeInstanceWithInternals | null);
  const requested = getRequestedShareConfig(pkgName, runtimeInstance, extraOptions);
  const candidates = getRuntimeSharedCandidates(pkgName, runtimeInstance, requested.scope);
  const shareConfig = requested.shareConfig;
  const message = error instanceof Error ? error.message : String(error);
  const requestedVersion =
    typeof shareConfig?.requiredVersion === 'string' || shareConfig?.requiredVersion === false
      ? shareConfig.requiredVersion
      : undefined;
  const classification = classifySharedResolutionError(shareConfig, message);

  pushSharedResolution({
    candidates,
    consumer: getRuntimeConsumerName(runtimeInstance),
    error: message,
    fallbackSource: classification.fallbackSource,
    matchType: inferSharedMatchType(pkgName, runtimeInstance?.options?.shared),
    pkgName,
    reason: classification.reason,
    requestedResolvedImportSource: requested.resolvedImportSource,
    requestedSourcePath: requested.sourcePath,
    requestedVersion,
    rejected: [],
    selected: null,
    shareScope: requested.scope,
    singleton: shareConfig?.singleton === true,
    status: classification.status,
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
        const classification = classifySharedResolutionError(args.shareInfo.shareConfig, message);

        pushSharedResolution({
          candidates,
          consumer: typeof args.shareInfo.from === 'string' ? args.shareInfo.from : null,
          error: message,
          fallbackSource: classification.fallbackSource,
          matchType: 'exact',
          pkgName: args.pkgName,
          reason: classification.reason,
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
          status: classification.status,
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
  try {
    const module = await loadNodeRuntimeModule(url);
    await module.evaluate();
    return module.namespace;
  } catch (error) {
    const cause = stripFormattedModuleFederationPrefix(getRuntimeErrorMessage(error));
    throw createModuleFederationError(
      'MFV-004',
      `Failed to load node federation entry "${url}". Ensure the SSR host can fetch the remote entry from the server process, the remote exposes an ESM SSR entry, and Node is started with --experimental-vm-modules when SourceTextModule is required. Cause: ${cause}`,
    );
  }
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
      contractVersion?: string;
      eventLimit?: number;
      events?: Array<Record<string, unknown>>;
      exportSnapshot?: () => unknown;
      lastUpdatedAt?: string;
      runtime?: unknown;
    };
  };

  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__ ||= {};
  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__.contractVersion = DEVTOOLS_CONTRACT_VERSION;
  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__.eventLimit = MAX_DEVTOOLS_EVENTS;
  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__.events ||= [];
  state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__.exportSnapshot ||= () => ({
    apps: state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__?.apps || {},
    contractVersion: state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__?.contractVersion,
    events: [...(state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__?.events || [])],
    lastUpdatedAt: state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__?.lastUpdatedAt || null,
    runtime: state.__VITE_PLUGIN_FEDERATION_DEVTOOLS__?.runtime || null,
  });

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

interface RuntimeRemoteLoadMetricContext {
  entry?: string;
  manifestUrl?: string;
  remoteAlias?: string;
  remoteName?: string;
  registrationDurationMs?: number;
  runtimeKey?: string;
  shareScope?: string;
  sourceUrl?: string;
  target?: FederationRuntimeTarget;
  totalStartedAt?: number;
}

async function loadRemoteWithRuntimeMetrics<T>(
  remoteId: string,
  loadOptions: Parameters<ModuleFederation['loadRemote']>[1],
  context: RuntimeRemoteLoadMetricContext = {},
) {
  const debugState = getRuntimeDebugState();
  const loadStartedAt = Date.now();
  const totalStartedAt = context.totalStartedAt || loadStartedAt;
  const remoteAlias = context.remoteAlias || remoteId.split('/')[0] || remoteId;

  try {
    const result = await loadRuntimeRemote<T>(remoteId, loadOptions);
    const now = Date.now();
    debugState.lastLoadRemote = {
      remoteId,
      timestamp: new Date(now).toISOString(),
    };
    recordRemoteLoadMetric({
      durationMs: now - totalStartedAt,
      entry: context.entry,
      loadDurationMs: now - loadStartedAt,
      manifestUrl: context.manifestUrl,
      phase: 'load',
      registrationDurationMs: context.registrationDurationMs,
      remoteAlias,
      remoteId,
      remoteName: context.remoteName,
      runtimeKey: context.runtimeKey,
      shareScope: context.shareScope,
      sourceUrl: context.sourceUrl,
      status: 'success',
      target: context.target,
      timestamp: new Date(now).toISOString(),
    });
    publishRuntimeDebugUpdate('load-remote');
    return result;
  } catch (error) {
    const now = Date.now();
    recordRemoteLoadMetric({
      durationMs: now - totalStartedAt,
      entry: context.entry,
      error: getRuntimeErrorMessage(error),
      loadDurationMs: now - loadStartedAt,
      manifestUrl: context.manifestUrl,
      phase: 'load',
      registrationDurationMs: context.registrationDurationMs,
      remoteAlias,
      remoteId,
      remoteName: context.remoteName,
      runtimeKey: context.runtimeKey,
      shareScope: context.shareScope,
      sourceUrl: context.sourceUrl,
      status: 'failure',
      target: context.target,
      timestamp: new Date(now).toISOString(),
    });
    recordRuntimeLoadError(remoteId, error, context);
    publishRuntimeDebugUpdate('load-error');
    throw error;
  }
}

export async function loadRemote<T>(...args: Parameters<ModuleFederation['loadRemote']>) {
  return loadRemoteWithRuntimeMetrics<T>(args[0], args[1]);
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

function getRuntimeKey(runtimeKey?: string) {
  return runtimeKey || 'default';
}

function getManifestCacheKey(manifestUrl: string, runtimeKey?: string) {
  return `${getRuntimeKey(runtimeKey)}:${manifestUrl}`;
}

function getManifestRequestKey(
  remoteAlias: string,
  manifestUrl: string,
  target: FederationRuntimeTarget,
  runtimeKey?: string,
) {
  return `${getRuntimeKey(runtimeKey)}:${target}:${remoteAlias}:${manifestUrl}`;
}

function findRegisteredManifestRemoteForDebug(
  remoteId: string,
  target = getDefaultTarget(),
  runtimeKey?: string,
) {
  const [remoteAlias] = remoteId.split('/');
  if (!remoteAlias) return undefined;

  const debugState = getRuntimeDebugState();
  const remotes = [...debugState.registeredManifestRemotes.values()].filter(
    (remote) =>
      remote.alias === remoteAlias &&
      (!runtimeKey || remote.runtimeKey === getRuntimeKey(runtimeKey)),
  );
  return remotes.find((remote) => remote.target === target) || remotes.at(-1);
}

function recordRuntimeLoadError(
  remoteId: string,
  error: unknown,
  context: {
    entry?: string;
    manifestUrl?: string;
    remoteAlias?: string;
    remoteName?: string;
    shareScope?: string;
    target?: FederationRuntimeTarget;
    runtimeKey?: string;
  } = {},
) {
  const debugState = getRuntimeDebugState();
  const remoteAlias = context.remoteAlias || remoteId.split('/')[0] || remoteId;
  const registeredManifestRemote = findRegisteredManifestRemoteForDebug(
    remoteId,
    context.target || getDefaultTarget(),
    context.runtimeKey,
  );

  debugState.lastLoadError = {
    code: getModuleFederationErrorCode(error) || 'MFV-004',
    entry: context.entry || registeredManifestRemote?.entry,
    manifestUrl: context.manifestUrl || registeredManifestRemote?.manifestUrl,
    message: getRuntimeErrorMessage(error),
    remoteAlias,
    remoteId,
    remoteName: context.remoteName || registeredManifestRemote?.name,
    runtimeKey: context.runtimeKey || registeredManifestRemote?.runtimeKey,
    shareScope: context.shareScope || registeredManifestRemote?.shareScope,
    target: context.target || registeredManifestRemote?.target,
    timestamp: new Date().toISOString(),
  };
}

function getRuntimeHookName(kind: FederationRuntimeHookKind) {
  if (kind === 'manifest-fetch') return 'manifestFetch';
  if (kind === 'remote-register') return 'remoteRegister';
  if (kind === 'remote-load') return 'remoteLoad';
  return 'remoteRefresh';
}

function emitRuntimeHook(
  hooks: FederationRuntimeHooks | undefined,
  event: Omit<FederationRuntimeHookEvent, 'timestamp'>,
) {
  if (!hooks) return;

  const hookEvent: FederationRuntimeHookEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  const handler = hooks[getRuntimeHookName(event.kind)];

  try {
    handler?.(hookEvent);
    hooks.telemetry?.(hookEvent);
  } catch (error) {
    mfWarnWithCode(
      'MFV-004',
      `Federation runtime hook "${event.kind}" failed: ${getRuntimeErrorMessage(error)}`,
    );
  }
}

function normalizeManifestFallbackUrls(manifestUrl: string, fallbackUrls: string[] | undefined) {
  const urls = [manifestUrl, ...(fallbackUrls || [])].filter(
    (url): url is string => typeof url === 'string' && url.length > 0,
  );
  return [...new Set(urls)];
}

function normalizeManifestCircuitBreakerOptions(
  options: ManifestFetchOptions['circuitBreaker'],
): Required<ManifestCircuitBreakerOptions> | null {
  if (!options) return null;
  if (options === true) {
    return {
      cooldownMs: 30_000,
      failureThreshold: 3,
    };
  }
  return {
    cooldownMs: Math.max(0, options.cooldownMs ?? 30_000),
    failureThreshold: Math.max(1, Math.floor(options.failureThreshold ?? 3)),
  };
}

function assertManifestCircuitBreakerAllowsRequest(
  manifestUrl: string,
  options: ManifestFetchOptions,
) {
  const circuitBreakerOptions = normalizeManifestCircuitBreakerOptions(options.circuitBreaker);
  if (!circuitBreakerOptions) return;

  const debugState = getRuntimeDebugState();
  const cacheKey = getManifestCacheKey(manifestUrl, options.runtimeKey);
  const runtimeKey = getRuntimeKey(options.runtimeKey);
  const state = debugState.manifestCircuitBreakers.get(cacheKey);
  if (!state || state.state !== 'open' || !state.nextRetryAt || Date.now() >= state.nextRetryAt) {
    return;
  }

  const error = createModuleFederationError(
    'MFV-004',
    `Manifest circuit breaker is open for "${manifestUrl}" until ${new Date(state.nextRetryAt).toISOString()}.`,
  );
  markManifestFetchError(error, { retriable: true });
  recordManifestFetch({
    attempt: 0,
    error: error.message,
    manifestUrl,
    runtimeKey,
    status: 'circuit-open',
    timestamp: new Date().toISOString(),
  });
  emitRuntimeHook(options.hooks, {
    error: error.message,
    kind: 'manifest-fetch',
    manifestUrl,
    primaryManifestUrl: manifestUrl,
    runtimeKey,
    stage: 'error',
    status: 'circuit-open',
  });
  throw error;
}

function recordManifestCircuitBreakerSuccess(manifestUrl: string, options: ManifestFetchOptions) {
  if (!normalizeManifestCircuitBreakerOptions(options.circuitBreaker)) return;
  getRuntimeDebugState().manifestCircuitBreakers.set(
    getManifestCacheKey(manifestUrl, options.runtimeKey),
    {
      failureCount: 0,
      lastFailureAt: null,
      manifestUrl,
      nextRetryAt: null,
      openedAt: null,
      runtimeKey: getRuntimeKey(options.runtimeKey),
      state: 'closed',
    },
  );
}

function recordManifestCircuitBreakerFailure(manifestUrl: string, options: ManifestFetchOptions) {
  const circuitBreakerOptions = normalizeManifestCircuitBreakerOptions(options.circuitBreaker);
  if (!circuitBreakerOptions) return;

  const debugState = getRuntimeDebugState();
  const cacheKey = getManifestCacheKey(manifestUrl, options.runtimeKey);
  const current = debugState.manifestCircuitBreakers.get(cacheKey);
  const failureCount = (current?.failureCount || 0) + 1;
  const now = Date.now();
  const shouldOpen = failureCount >= circuitBreakerOptions.failureThreshold;

  debugState.manifestCircuitBreakers.set(cacheKey, {
    failureCount,
    lastFailureAt: now,
    manifestUrl,
    nextRetryAt: shouldOpen ? now + circuitBreakerOptions.cooldownMs : null,
    openedAt: shouldOpen ? current?.openedAt || now : null,
    runtimeKey: getRuntimeKey(options.runtimeKey),
    state: shouldOpen ? 'open' : 'closed',
  });
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

function normalizeManifestIntegrityOptions(
  options: RegisterManifestRemoteOptions['integrity'],
): NormalizedManifestIntegrityOptions | null {
  if (!options) {
    return null;
  }

  const mode = (typeof options === 'object' ? options.mode : undefined) || 'prefer-integrity';
  if (
    mode !== 'prefer-integrity' &&
    mode !== 'integrity' &&
    mode !== 'content-hash' &&
    mode !== 'both'
  ) {
    throw createModuleFederationError(
      'MFV-004',
      `Invalid manifest integrity mode "${String(mode)}". Expected "prefer-integrity", "integrity", "content-hash", or "both".`,
    );
  }

  return { mode };
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

function parseSriIntegrity(
  manifestUrl: string,
  assetUrl: string,
  integrity: string,
): {
  algorithm: 'sha256' | 'sha384' | 'sha512';
  subtleAlgorithm: 'SHA-256' | 'SHA-384' | 'SHA-512';
  value: string;
} {
  const match = integrity.match(/^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw createModuleFederationError(
      'MFV-004',
      `Federation manifest "${manifestUrl}" declares unsupported integrity "${integrity}" for "${assetUrl}". Expected sha256/sha384/sha512 SRI format.`,
    );
  }

  const algorithm = match[1] as 'sha256' | 'sha384' | 'sha512';
  return {
    algorithm,
    subtleAlgorithm:
      algorithm === 'sha256' ? 'SHA-256' : algorithm === 'sha384' ? 'SHA-384' : 'SHA-512',
    value: match[2],
  };
}

async function digestArrayBuffer(
  buffer: ArrayBuffer,
  algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512',
) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) {
    throw createModuleFederationError(
      'MFV-004',
      'Web Crypto API is unavailable. Manifest integrity verification requires crypto.subtle.digest.',
    );
  }

  return new Uint8Array(await subtle.digest(algorithm, buffer));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(binary);
  }

  const bufferCtor = (
    globalThis as typeof globalThis & {
      Buffer?: {
        from(input: Uint8Array): { toString(encoding: 'base64'): string };
      };
    }
  ).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(bytes).toString('base64');
  }

  throw createModuleFederationError(
    'MFV-004',
    'Unable to encode integrity digest as base64 in the current runtime environment.',
  );
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

function getManifestAssetReferencePath(asset: FederationManifestAssetReference) {
  if (typeof asset === 'string') {
    return asset;
  }

  if (typeof asset.url === 'string' && asset.url.length > 0) {
    return asset.url;
  }

  if (typeof asset.href === 'string' && asset.href.length > 0) {
    return asset.href;
  }

  return joinUrlPath(asset.path, asset.name);
}

function resolveFederationManifestAssetReferenceUrl(
  manifestUrl: string,
  manifest: Pick<FederationRemoteManifest, 'metaData'>,
  asset: FederationManifestAssetReference,
) {
  return resolveFederationManifestAssetUrl(
    manifestUrl,
    manifest,
    getManifestAssetReferencePath(asset),
  );
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
    resolveFederationManifestAssetReferenceUrl(manifestUrl, manifest, asset),
  );
  const async = (group?.async || []).map((asset) =>
    resolveFederationManifestAssetReferenceUrl(manifestUrl, manifest, asset),
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

function normalizeFederationPreloadRoutes(
  routes: FederationPreloadRoutes,
): FederationPreloadRouteConfig[] {
  if (Array.isArray(routes)) {
    return routes.map((route) => ({
      exposes: route.exposes,
      route: route.route,
    }));
  }

  return Object.entries(routes).map(([route, config]) => {
    if (typeof config === 'object' && !Array.isArray(config)) {
      return {
        exposes: config.exposes,
        route,
      };
    }
    return {
      exposes: config,
      route,
    };
  });
}

function normalizeExposeList(exposes: string | string[]) {
  return Array.isArray(exposes) ? exposes : [exposes];
}

function resolvePreloadPlanCollectionOptions(
  options: CreateFederationManifestPreloadPlanOptions,
): CollectFederationManifestPreloadLinksOptions {
  const asyncChunkPolicy = options.asyncChunkPolicy || 'css';
  return {
    ...options,
    includeAsyncCss:
      options.includeAsyncCss ?? (asyncChunkPolicy === 'all' || asyncChunkPolicy === 'css'),
    includeAsyncJs:
      options.includeAsyncJs ?? (asyncChunkPolicy === 'all' || asyncChunkPolicy === 'js'),
  };
}

function routeMatchesPreloadHint(route: string, hint: FederationManifestPreloadHint) {
  return !hint.route || hint.route === route;
}

function hintMatchesExposes(exposes: string[], hint: FederationManifestPreloadHint) {
  const hintExposes = [
    ...(hint.expose ? [hint.expose] : []),
    ...(Array.isArray(hint.exposes) ? hint.exposes : []),
  ];
  if (hintExposes.length === 0) {
    return true;
  }

  const normalizedExposes = new Set(exposes.map(normalizeExposePath));
  return hintExposes.some((expose) => normalizedExposes.has(normalizeExposePath(expose)));
}

function pushFederationManifestHintAssetLinks(
  links: FederationManifestPreloadLink[],
  seen: Set<string>,
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  hint: FederationManifestPreloadHint,
  options: CollectFederationManifestPreloadLinksOptions,
) {
  const loading = hint.loading || 'sync';
  const crossorigin = normalizePreloadCrossorigin(options.crossorigin);
  const exposePath = hint.expose || hint.exposes?.[0] || '*';
  const expose = {
    name: exposePath,
    path: exposePath,
  };

  for (const asset of hint.assets?.css || []) {
    if (options.includeCss === false) continue;
    pushFederationManifestPreloadLink(links, seen, {
      assetType: 'css',
      expose,
      exposePath,
      href: resolveFederationManifestAssetReferenceUrl(manifestUrl, manifest, asset),
      loading,
      rel: 'stylesheet',
    });
  }

  for (const asset of hint.assets?.js || []) {
    if (options.includeJs === false) continue;
    if (loading === 'async' && options.includeAsyncJs !== true) continue;
    pushFederationManifestPreloadLink(links, seen, {
      assetType: 'js',
      ...(crossorigin ? { crossorigin } : {}),
      expose,
      exposePath,
      href: resolveFederationManifestAssetReferenceUrl(manifestUrl, manifest, asset),
      loading,
      rel: 'modulepreload',
    });
  }
}

function collectFederationManifestHintLinks(
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  route: FederationPreloadRouteConfig,
  options: CollectFederationManifestPreloadLinksOptions,
) {
  const links: FederationManifestPreloadLink[] = [];
  const seen = new Set<string>();
  const exposes = normalizeExposeList(route.exposes);
  const topLevelHint: FederationManifestPreloadHint | undefined = manifest.preload?.assets
    ? {
        assets: manifest.preload.assets,
      }
    : undefined;
  const hints = [...(topLevelHint ? [topLevelHint] : []), ...(manifest.preload?.routes || [])];

  for (const hint of hints) {
    if (!routeMatchesPreloadHint(route.route, hint) || !hintMatchesExposes(exposes, hint)) {
      continue;
    }
    if (hint.assets) {
      pushFederationManifestHintAssetLinks(links, seen, manifestUrl, manifest, hint, options);
    }
  }

  return links;
}

export function createFederationManifestPreloadPlan(
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  routes: FederationPreloadRoutes,
  options: CreateFederationManifestPreloadPlanOptions = {},
): FederationManifestPreloadPlan {
  const collectionOptions = resolvePreloadPlanCollectionOptions(options);
  const includeManifestHints = options.includeManifestHints !== false;
  const seen = new Set<string>();
  const allLinks: FederationManifestPreloadLink[] = [];
  const planRoutes = normalizeFederationPreloadRoutes(routes).map((route) => {
    const exposes = normalizeExposeList(route.exposes);
    const routeLinks = [
      ...collectFederationManifestPreloadLinks(manifestUrl, manifest, exposes, collectionOptions),
      ...(includeManifestHints
        ? collectFederationManifestHintLinks(manifestUrl, manifest, route, collectionOptions)
        : []),
    ];
    const dedupedRouteLinks: FederationManifestPreloadLink[] = [];
    const routeSeen = new Set<string>();

    for (const link of routeLinks) {
      pushFederationManifestPreloadLink(dedupedRouteLinks, routeSeen, link);
      pushFederationManifestPreloadLink(allLinks, seen, link);
    }

    return {
      exposes,
      links: dedupedRouteLinks,
      route: route.route,
    };
  });

  return {
    links: allLinks,
    manifestUrl,
    remoteName: manifest.name,
    routes: planRoutes,
  };
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

function recordManifestIntegrityCheck(entry: ManifestIntegrityCheckLogEntry) {
  const debugState = getRuntimeDebugState();
  debugState.manifestIntegrityChecks.push(entry);
  if (debugState.manifestIntegrityChecks.length > 50) {
    debugState.manifestIntegrityChecks.shift();
  }
}

function recordRemoteLoadMetric(entry: RemoteLoadMetricLogEntry) {
  const debugState = getRuntimeDebugState();
  debugState.remoteLoadMetrics.push(entry);
  if (debugState.remoteLoadMetrics.length > 100) {
    debugState.remoteLoadMetrics.shift();
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

async function fetchManifestAssetResponse(
  manifestUrl: string,
  assetUrl: string,
  fetchImplementation: typeof fetch,
  options: ManifestFetchOptions,
) {
  if (!options.timeout || options.timeout <= 0 || typeof AbortController === 'undefined') {
    return fetchImplementation(assetUrl, options.fetchInit);
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
        createModuleFederationError(
          'MFV-004',
          `Timed out fetching federation asset "${assetUrl}" declared by manifest "${manifestUrl}" after ${options.timeout}ms.`,
        ),
      );
    }, options.timeout);
  });

  try {
    return await Promise.race([
      fetchImplementation(assetUrl, {
        ...fetchInit,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (didTimeout) {
      throw createModuleFederationError(
        'MFV-004',
        `Timed out fetching federation asset "${assetUrl}" declared by manifest "${manifestUrl}" after ${options.timeout}ms.`,
      );
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

async function verifyManifestEntryIntegrity(
  manifestUrl: string,
  assetUrl: string,
  entry: FederationRemoteManifestEntry,
  target: FederationRuntimeTarget,
  options: RegisterManifestRemoteOptions,
  fieldPath = `metaData.${target === 'node' ? 'ssrRemoteEntry' : 'remoteEntry'}`,
) {
  const integrityOptions = normalizeManifestIntegrityOptions(options.integrity);
  if (!integrityOptions) {
    return;
  }

  const expectedIntegrity = typeof entry.integrity === 'string' ? entry.integrity : undefined;
  const expectedContentHash =
    typeof entry.contentHash === 'string' ? entry.contentHash.toLowerCase() : undefined;
  const requiresIntegrity =
    integrityOptions.mode === 'integrity' ||
    integrityOptions.mode === 'both' ||
    (integrityOptions.mode === 'prefer-integrity' && Boolean(expectedIntegrity));
  const requiresContentHash =
    integrityOptions.mode === 'content-hash' ||
    integrityOptions.mode === 'both' ||
    (integrityOptions.mode === 'prefer-integrity' && !expectedIntegrity);

  const fetchImplementation = getManifestFetchImplementation(options.fetch);
  const verifiedWith: Array<'contentHash' | 'integrity'> = [];
  let actualIntegrity: string | undefined;
  let actualContentHash: string | undefined;

  try {
    if (requiresIntegrity && !expectedIntegrity) {
      throw createModuleFederationError(
        'MFV-004',
        `Federation manifest "${manifestUrl}" does not declare ${fieldPath}.integrity for "${assetUrl}".`,
      );
    }

    if (requiresContentHash && !expectedContentHash) {
      throw createModuleFederationError(
        'MFV-004',
        `Federation manifest "${manifestUrl}" does not declare ${fieldPath}.contentHash for "${assetUrl}".`,
      );
    }

    const response = await fetchManifestAssetResponse(
      manifestUrl,
      assetUrl,
      fetchImplementation,
      options,
    );
    if (!response.ok) {
      throw createModuleFederationError(
        'MFV-004',
        `Failed to fetch federation asset "${assetUrl}" declared by manifest "${manifestUrl}" with status ${response.status}.`,
      );
    }

    const buffer = await response.arrayBuffer();
    const digestCache = new Map<string, Promise<Uint8Array>>();
    const getDigest = (algorithm: 'SHA-256' | 'SHA-384' | 'SHA-512') => {
      const cacheKey = algorithm;
      if (!digestCache.has(cacheKey)) {
        digestCache.set(cacheKey, digestArrayBuffer(buffer, algorithm));
      }
      return digestCache.get(cacheKey)!;
    };

    if (requiresIntegrity && expectedIntegrity) {
      const parsedIntegrity = parseSriIntegrity(manifestUrl, assetUrl, expectedIntegrity);
      const digest = await getDigest(parsedIntegrity.subtleAlgorithm);
      actualIntegrity = `${parsedIntegrity.algorithm}-${bytesToBase64(digest)}`;
      verifiedWith.push('integrity');

      if (actualIntegrity !== expectedIntegrity) {
        throw createModuleFederationError(
          'MFV-004',
          `Federation asset "${assetUrl}" failed integrity verification from manifest "${manifestUrl}". Expected ${expectedIntegrity} but received ${actualIntegrity}.`,
        );
      }
    }

    if (requiresContentHash && expectedContentHash) {
      const digest = await getDigest('SHA-256');
      actualContentHash = bytesToHex(digest);
      verifiedWith.push('contentHash');

      if (actualContentHash !== expectedContentHash) {
        throw createModuleFederationError(
          'MFV-004',
          `Federation asset "${assetUrl}" failed contentHash verification from manifest "${manifestUrl}". Expected ${expectedContentHash} but received ${actualContentHash}.`,
        );
      }
    }

    recordManifestIntegrityCheck({
      actualContentHash,
      actualIntegrity,
      assetUrl,
      expectedContentHash,
      expectedIntegrity,
      manifestUrl,
      mode: integrityOptions.mode,
      status: 'success',
      target,
      timestamp: new Date().toISOString(),
      verifiedWith,
    });
    publishRuntimeDebugUpdate('manifest-integrity');
  } catch (error) {
    recordManifestIntegrityCheck({
      actualContentHash,
      actualIntegrity,
      assetUrl,
      error: error instanceof Error ? error.message : String(error),
      expectedContentHash,
      expectedIntegrity,
      manifestUrl,
      mode: integrityOptions.mode,
      status: 'failure',
      target,
      timestamp: new Date().toISOString(),
      verifiedWith,
    });
    publishRuntimeDebugUpdate('manifest-integrity');
    throw error;
  }
}

interface ManifestAssetIntegrityTarget {
  asset: FederationManifestAssetReference;
  fieldPath: string;
}

function pushManifestAssetIntegrityTargets(
  targets: ManifestAssetIntegrityTarget[],
  assets: FederationManifestAssetReference[] | undefined,
  fieldPath: string,
) {
  assets?.forEach((asset, index) => {
    targets.push({
      asset,
      fieldPath: `${fieldPath}[${index}]`,
    });
  });
}

function collectManifestAssetIntegrityTargets(
  manifest: FederationRemoteManifest,
  options: VerifyFederationManifestAssetsOptions,
) {
  const targets: ManifestAssetIntegrityTarget[] = [];

  if (options.includeExposes !== false && Array.isArray(manifest.exposes)) {
    manifest.exposes.forEach((expose, exposeIndex) => {
      pushManifestAssetIntegrityTargets(
        targets,
        expose.assets?.css?.sync,
        `exposes[${exposeIndex}].assets.css.sync`,
      );
      pushManifestAssetIntegrityTargets(
        targets,
        expose.assets?.css?.async,
        `exposes[${exposeIndex}].assets.css.async`,
      );
      pushManifestAssetIntegrityTargets(
        targets,
        expose.assets?.js?.sync,
        `exposes[${exposeIndex}].assets.js.sync`,
      );
      pushManifestAssetIntegrityTargets(
        targets,
        expose.assets?.js?.async,
        `exposes[${exposeIndex}].assets.js.async`,
      );
    });
  }

  if (options.includePreloadHints !== false) {
    pushManifestAssetIntegrityTargets(targets, manifest.preload?.assets?.css, 'preload.assets.css');
    pushManifestAssetIntegrityTargets(targets, manifest.preload?.assets?.js, 'preload.assets.js');

    manifest.preload?.routes?.forEach((hint, hintIndex) => {
      pushManifestAssetIntegrityTargets(
        targets,
        hint.assets?.css,
        `preload.routes[${hintIndex}].assets.css`,
      );
      pushManifestAssetIntegrityTargets(
        targets,
        hint.assets?.js,
        `preload.routes[${hintIndex}].assets.js`,
      );
    });
  }

  return targets;
}

function getManifestAssetIntegrityEntry(
  manifestUrl: string,
  target: ManifestAssetIntegrityTarget,
  requireIntegrity: boolean,
) {
  if (typeof target.asset === 'string') {
    if (requireIntegrity) {
      throw createModuleFederationError(
        'MFV-004',
        `Federation manifest "${manifestUrl}" does not declare integrity metadata for ${target.fieldPath}.`,
      );
    }
    return null;
  }

  if (!target.asset.integrity && !target.asset.contentHash) {
    if (requireIntegrity) {
      throw createModuleFederationError(
        'MFV-004',
        `Federation manifest "${manifestUrl}" does not declare integrity metadata for ${target.fieldPath}.`,
      );
    }
    return null;
  }

  return target.asset;
}

export async function verifyFederationManifestAssets(
  manifestUrl: string,
  manifest: FederationRemoteManifest,
  options: VerifyFederationManifestAssetsOptions = {},
): Promise<VerifyFederationManifestAssetsResult> {
  const verificationOptions = {
    ...options,
    integrity: options.integrity ?? true,
  };
  const target = getDefaultTarget(options.target);
  let checked = 0;
  let skipped = 0;
  const verifiedAssets: string[] = [];

  for (const assetTarget of collectManifestAssetIntegrityTargets(manifest, options)) {
    const entry = getManifestAssetIntegrityEntry(
      manifestUrl,
      assetTarget,
      options.requireIntegrity === true,
    );
    if (!entry) {
      skipped += 1;
      continue;
    }

    const assetPath = getManifestAssetReferencePath(entry);
    if (!assetPath) {
      throw createModuleFederationError(
        'MFV-004',
        `Federation manifest "${manifestUrl}" does not declare a usable asset path for ${assetTarget.fieldPath}.`,
      );
    }

    const assetUrl = resolveFederationManifestAssetReferenceUrl(manifestUrl, manifest, entry);
    await verifyManifestEntryIntegrity(
      manifestUrl,
      assetUrl,
      entry,
      target,
      verificationOptions,
      assetTarget.fieldPath,
    );
    checked += 1;
    verifiedAssets.push(assetUrl);
  }

  return {
    checked,
    skipped,
    verifiedAssets,
  };
}

async function fetchManifestJsonWithRetries(
  manifestUrl: string,
  options: ManifestFetchOptions,
): Promise<ManifestFetchResult> {
  assertManifestCircuitBreakerAllowsRequest(manifestUrl, options);

  const fetchImplementation = getManifestFetchImplementation(options.fetch);
  const candidateUrls = normalizeManifestFallbackUrls(manifestUrl, options.fallbackUrls);
  const maxRetries = Math.max(0, Math.floor(options.retries || 0));
  let lastError: unknown;

  for (const candidateUrl of candidateUrls) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const startedAt = Date.now();

      emitRuntimeHook(options.hooks, {
        kind: 'manifest-fetch',
        manifestUrl: candidateUrl,
        primaryManifestUrl: manifestUrl,
        runtimeKey: getRuntimeKey(options.runtimeKey),
        stage: 'before',
      });

      try {
        const response = await fetchManifestResponse(candidateUrl, fetchImplementation, options);
        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
          throw markManifestFetchError(
            createModuleFederationError(
              'MFV-004',
              `Failed to fetch federation manifest "${candidateUrl}" with status ${response.status}.`,
            ),
            {
              retriable:
                response.status === 408 || response.status === 429 || response.status >= 500,
              status: response.status,
            },
          );
        }

        const manifest = (await response.json()) as FederationRemoteManifest;
        validateManifest(candidateUrl, manifest);
        recordManifestFetch({
          attempt,
          durationMs,
          manifestUrl: candidateUrl,
          primaryManifestUrl: manifestUrl,
          runtimeKey: getRuntimeKey(options.runtimeKey),
          sourceUrl: candidateUrl,
          status: 'success',
          statusCode: response.status,
          timestamp: new Date().toISOString(),
        });
        emitRuntimeHook(options.hooks, {
          durationMs,
          kind: 'manifest-fetch',
          manifestUrl: candidateUrl,
          primaryManifestUrl: manifestUrl,
          runtimeKey: getRuntimeKey(options.runtimeKey),
          sourceUrl: candidateUrl,
          stage: 'after',
          status: 'success',
          statusCode: response.status,
        });
        recordManifestCircuitBreakerSuccess(manifestUrl, options);
        return {
          manifest,
          sourceUrl: candidateUrl,
        };
      } catch (error) {
        lastError = error;
        const shouldRetry = attempt < maxRetries && isRetriableManifestFetchError(error);
        const status = shouldRetry ? 'retry' : 'failure';
        const durationMs = Date.now() - startedAt;
        recordManifestFetch({
          attempt,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
          manifestUrl: candidateUrl,
          primaryManifestUrl: manifestUrl,
          runtimeKey: getRuntimeKey(options.runtimeKey),
          status,
          statusCode: getManifestFetchErrorStatus(error),
          timestamp: new Date().toISOString(),
        });
        emitRuntimeHook(options.hooks, {
          durationMs,
          error: getRuntimeErrorMessage(error),
          kind: 'manifest-fetch',
          manifestUrl: candidateUrl,
          primaryManifestUrl: manifestUrl,
          runtimeKey: getRuntimeKey(options.runtimeKey),
          stage: 'error',
          status,
          statusCode: getManifestFetchErrorStatus(error),
        });

        if (shouldRetry) {
          await wait(getManifestRetryDelay(options, attempt, error));
          continue;
        }

        break;
      }
    }
  }

  recordManifestCircuitBreakerFailure(manifestUrl, options);
  throw toManifestFetchError(manifestUrl, lastError);
}

function revalidateStaleFederationManifest(manifestUrl: string, options: ManifestFetchOptions) {
  const debugState = getRuntimeDebugState();
  const cacheKey = getManifestCacheKey(manifestUrl, options.runtimeKey);
  if (debugState.manifestRequests.has(cacheKey)) return;

  const revalidateOptions: ManifestFetchOptions = {
    ...options,
    force: true,
    staleWhileRevalidate: false,
  };

  const revalidatePromise = fetchManifestJsonWithRetries(manifestUrl, revalidateOptions)
    .then(({ manifest, sourceUrl }) => {
      debugState.manifestSourceUrls.set(cacheKey, sourceUrl);
      if (isManifestCacheEnabled(options)) {
        debugState.manifestCache.set(cacheKey, {
          expiresAt: getManifestCacheExpiry(options),
          fetchedAt: Date.now(),
          manifestUrl,
          manifest,
          runtimeKey: getRuntimeKey(options.runtimeKey),
          sourceUrl,
        });
      }
      publishRuntimeDebugUpdate('manifest-fetched');
      return manifest;
    })
    .catch((error) => {
      const manifestError = toManifestFetchError(manifestUrl, error);
      debugState.lastLoadError = {
        code: 'MFV-004',
        manifestUrl,
        message: manifestError.message,
        remoteId: manifestUrl,
        runtimeKey: getRuntimeKey(options.runtimeKey),
        timestamp: new Date().toISOString(),
      };
      publishRuntimeDebugUpdate('load-error');
      return debugState.manifestCache.get(cacheKey)?.manifest as FederationRemoteManifest;
    })
    .finally(() => {
      debugState.manifestRequests.delete(cacheKey);
    });

  debugState.manifestRequests.set(cacheKey, revalidatePromise);
}

export async function fetchFederationManifest(
  manifestUrl: string,
  options: ManifestFetchOptions = {},
) {
  const debugState = getRuntimeDebugState();
  const cacheKey = getManifestCacheKey(manifestUrl, options.runtimeKey);
  const runtimeKey = getRuntimeKey(options.runtimeKey);
  if (options.force) {
    debugState.manifestCache.delete(cacheKey);
    debugState.manifestRequests.delete(cacheKey);
    debugState.manifestSourceUrls.delete(cacheKey);
  }

  const cachedManifest = debugState.manifestCache.get(cacheKey);
  if (
    cachedManifest &&
    !options.force &&
    isManifestCacheEnabled(options) &&
    isManifestCacheEntryFresh(cachedManifest)
  ) {
    recordManifestFetch({
      attempt: 0,
      manifestUrl,
      runtimeKey,
      sourceUrl: cachedManifest.sourceUrl,
      status: 'cache-hit',
      timestamp: new Date().toISOString(),
    });
    return cachedManifest.manifest;
  }

  if (cachedManifest && !isManifestCacheEntryFresh(cachedManifest)) {
    if (options.staleWhileRevalidate) {
      recordManifestFetch({
        attempt: 0,
        manifestUrl,
        runtimeKey,
        sourceUrl: cachedManifest.sourceUrl,
        status: 'stale-cache-hit',
        timestamp: new Date().toISOString(),
      });
      revalidateStaleFederationManifest(manifestUrl, options);
      return cachedManifest.manifest;
    }
    debugState.manifestCache.delete(cacheKey);
  }

  const pendingManifest = debugState.manifestRequests.get(cacheKey);
  if (pendingManifest && !options.force) {
    return pendingManifest;
  }

  const fetchManifestPromise = (async () => {
    try {
      const { manifest, sourceUrl } = await fetchManifestJsonWithRetries(manifestUrl, options);
      debugState.manifestSourceUrls.set(cacheKey, sourceUrl);
      if (isManifestCacheEnabled(options)) {
        debugState.manifestCache.set(cacheKey, {
          expiresAt: getManifestCacheExpiry(options),
          fetchedAt: Date.now(),
          manifestUrl,
          manifest,
          runtimeKey,
          sourceUrl,
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
        runtimeKey,
        timestamp: new Date().toISOString(),
      };
      throw manifestError;
    } finally {
      debugState.manifestRequests.delete(cacheKey);
    }
  })();

  debugState.manifestRequests.set(cacheKey, fetchManifestPromise);
  return fetchManifestPromise;
}

export async function registerManifestRemote(
  remoteAlias: string,
  manifestUrl: string,
  options: RegisterManifestRemoteOptions = {},
) {
  const debugState = getRuntimeDebugState();
  const target = getDefaultTarget(options.target);
  const runtimeKey = getRuntimeKey(options.runtimeKey);
  const cacheKey = getManifestCacheKey(manifestUrl, runtimeKey);
  const requestKey = getManifestRequestKey(remoteAlias, manifestUrl, target, runtimeKey);

  if (!options.force) {
    const pendingRegistration = debugState.registrationRequests.get(requestKey);
    if (pendingRegistration) {
      return pendingRegistration;
    }
  }

  const registerPromise = (async () => {
    const startedAt = Date.now();
    emitRuntimeHook(options.hooks, {
      kind: 'remote-register',
      manifestUrl,
      remoteAlias,
      runtimeKey,
      stage: 'before',
      target,
    });

    try {
      const manifest = await fetchFederationManifest(manifestUrl, options);
      const selectedEntry = getManifestEntryForTarget(manifestUrl, manifest, target);
      const manifestSourceUrl = debugState.manifestSourceUrls.get(cacheKey) || manifestUrl;
      const remoteName = options.remoteName || manifest.name || remoteAlias;
      const shareScope = options.shareScope || 'default';
      const remoteEntryUrl = resolveManifestAssetUrl(
        manifestSourceUrl,
        selectedEntry,
        manifest.metaData.publicPath,
      );

      await verifyManifestEntryIntegrity(
        manifestUrl,
        remoteEntryUrl,
        selectedEntry,
        target,
        options,
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
        runtimeKey,
        shareScope: registration.shareScope,
        sourceUrl: manifestSourceUrl,
        target,
        type: registration.type,
      });
      publishRuntimeDebugUpdate('manifest-registered');
      emitRuntimeHook(options.hooks, {
        durationMs: Date.now() - startedAt,
        entry: registration.entry,
        kind: 'remote-register',
        manifestUrl,
        remoteAlias,
        remoteName: registration.name,
        runtimeKey,
        shareScope: registration.shareScope,
        sourceUrl: manifestSourceUrl,
        stage: 'after',
        status: 'success',
        target,
      });

      return registration;
    } catch (error) {
      recordRuntimeLoadError(remoteAlias, error, {
        manifestUrl,
        remoteAlias,
        runtimeKey,
        target,
      });
      emitRuntimeHook(options.hooks, {
        durationMs: Date.now() - startedAt,
        error: getRuntimeErrorMessage(error),
        kind: 'remote-register',
        manifestUrl,
        remoteAlias,
        runtimeKey,
        stage: 'error',
        status: 'failure',
        target,
      });
      publishRuntimeDebugUpdate('load-error');
      throw error;
    }
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

function getRegisteredManifestRemote(
  remoteAlias: string,
  target: FederationRuntimeTarget,
  runtimeKey?: string,
) {
  const debugState = getRuntimeDebugState();
  return [...debugState.registeredManifestRemotes.entries()].find(([, remote]) => {
    return (
      remote.alias === remoteAlias &&
      remote.target === target &&
      (!runtimeKey || remote.runtimeKey === getRuntimeKey(runtimeKey))
    );
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

  const startedAt = Date.now();
  const target = getDefaultTarget(options.target);
  const registeredManifestRemote = getRegisteredManifestRemote(
    remoteAlias,
    target,
    options.runtimeKey,
  );
  const runtimeKey = getRuntimeKey(options.runtimeKey || registeredManifestRemote?.[1].runtimeKey);
  const manifestUrl = options.manifestUrl || registeredManifestRemote?.[1].manifestUrl;

  emitRuntimeHook(options.hooks, {
    kind: 'remote-refresh',
    manifestUrl,
    remoteAlias,
    remoteId: remoteIdOrAlias,
    runtimeKey,
    stage: 'before',
    target,
  });

  try {
    if (manifestUrl) {
      const debugState = getRuntimeDebugState();
      const requestKey =
        registeredManifestRemote?.[0] ||
        getManifestRequestKey(remoteAlias, manifestUrl, target, runtimeKey);
      const cacheKey = getManifestCacheKey(manifestUrl, runtimeKey);

      if (options.invalidateManifest !== false) {
        debugState.manifestCache.delete(cacheKey);
      }
      debugState.manifestRequests.delete(cacheKey);
      debugState.registrationRequests.delete(requestKey);
      debugState.registeredManifestRemotes.delete(requestKey);

      const registration = await registerManifestRemote(remoteAlias, manifestUrl, {
        ...options,
        force: true,
        remoteName: options.remoteName || registeredManifestRemote?.[1].name,
        runtimeKey,
        shareScope: options.shareScope || registeredManifestRemote?.[1].shareScope,
        target,
      });

      syncRegisteredRemoteDebugState();
      publishRuntimeDebugUpdate('refresh-remote');
      emitRuntimeHook(options.hooks, {
        durationMs: Date.now() - startedAt,
        entry: typeof registration.entry === 'string' ? registration.entry : undefined,
        kind: 'remote-refresh',
        manifestUrl,
        remoteAlias,
        remoteId: remoteIdOrAlias,
        remoteName: typeof registration.name === 'string' ? registration.name : undefined,
        runtimeKey,
        shareScope:
          typeof registration.shareScope === 'string' ? registration.shareScope : undefined,
        stage: 'after',
        status: 'success',
        target,
      });
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
        runtimeKey,
        shareScope:
          typeof runtimeRemoteRecord.shareScope === 'string'
            ? (runtimeRemoteRecord.shareScope as string)
            : options.shareScope,
        target,
      });

      syncRegisteredRemoteDebugState();
      publishRuntimeDebugUpdate('refresh-remote');
      emitRuntimeHook(options.hooks, {
        durationMs: Date.now() - startedAt,
        entry: typeof registration.entry === 'string' ? registration.entry : undefined,
        kind: 'remote-refresh',
        manifestUrl: runtimeRemoteEntry,
        remoteAlias,
        remoteId: remoteIdOrAlias,
        remoteName: typeof registration.name === 'string' ? registration.name : undefined,
        runtimeKey,
        shareScope:
          typeof registration.shareScope === 'string' ? registration.shareScope : undefined,
        stage: 'after',
        status: 'success',
        target,
      });
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
    emitRuntimeHook(options.hooks, {
      durationMs: Date.now() - startedAt,
      entry:
        typeof (refreshedRuntimeRemote as unknown as Record<string, unknown>).entry === 'string'
          ? ((refreshedRuntimeRemote as unknown as Record<string, unknown>).entry as string)
          : undefined,
      kind: 'remote-refresh',
      remoteAlias,
      remoteId: remoteIdOrAlias,
      runtimeKey,
      stage: 'after',
      status: 'success',
      target,
    });
    return runtimeRemote;
  } catch (error) {
    emitRuntimeHook(options.hooks, {
      durationMs: Date.now() - startedAt,
      error: getRuntimeErrorMessage(error),
      kind: 'remote-refresh',
      manifestUrl,
      remoteAlias,
      remoteId: remoteIdOrAlias,
      runtimeKey,
      stage: 'error',
      status: 'failure',
      target,
    });
    throw error;
  }
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

export async function warmFederationRemotes(
  remotes: Record<string, string | WarmFederationRemoteConfig> | WarmFederationRemoteConfig[],
  options: RegisterManifestRemoteOptions = {},
) {
  const entries = Array.isArray(remotes)
    ? remotes.map(
        (remote) =>
          [remote.remoteAlias || remote.remoteName || remote.manifestUrl, remote] as const,
      )
    : Object.entries(remotes);

  const warmed = await Promise.all(
    entries.map(async ([remoteAlias, remoteConfig]) => {
      const config =
        typeof remoteConfig === 'string'
          ? ({ manifestUrl: remoteConfig } satisfies WarmFederationRemoteConfig)
          : remoteConfig;
      const { manifestUrl, preload = true, remoteAlias: _remoteAlias, ...remoteOptions } = config;
      const registration = await registerManifestRemote(remoteAlias, manifestUrl, {
        ...options,
        ...remoteOptions,
        target: remoteOptions.target || options.target,
      });

      if (preload !== false) {
        const preloadConfig =
          typeof preload === 'object'
            ? {
                nameOrAlias: remoteAlias,
                ...preload,
              }
            : {
                nameOrAlias: remoteAlias,
              };
        await preloadRemote([preloadConfig] as Parameters<ModuleFederation['preloadRemote']>[0]);
      }

      return registration;
    }),
  );

  return warmed;
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
    circuitBreaker,
    fallbackUrls,
    fetch,
    fetchInit,
    force,
    hooks,
    integrity,
    remoteName,
    retries,
    retryDelay,
    runtimeKey,
    shareScope,
    staleWhileRevalidate,
    target,
    timeout,
    ...loadRemoteOptions
  } = options;

  const totalStartedAt = Date.now();
  let registrationDurationMs: number | undefined;
  let registration: Awaited<ReturnType<typeof registerManifestRemote>> | undefined;

  try {
    const registrationStartedAt = Date.now();
    registration = await registerManifestRemote(remoteAlias, manifestUrl, {
      cache,
      cacheTtl,
      circuitBreaker,
      fallbackUrls,
      fetch,
      fetchInit,
      force,
      hooks,
      integrity,
      remoteName,
      retries,
      retryDelay,
      runtimeKey,
      shareScope,
      staleWhileRevalidate,
      target,
      timeout,
    });
    registrationDurationMs = Date.now() - registrationStartedAt;
  } catch (error) {
    const now = Date.now();
    recordRemoteLoadMetric({
      durationMs: now - totalStartedAt,
      error: getRuntimeErrorMessage(error),
      manifestUrl,
      phase: 'register',
      remoteAlias,
      remoteId,
      runtimeKey: getRuntimeKey(runtimeKey),
      status: 'failure',
      target: getDefaultTarget(target),
      timestamp: new Date(now).toISOString(),
    });
    throw error;
  }

  const runtimeLoadOptions = {
    from: 'runtime',
    ...loadRemoteOptions,
  } as Parameters<ModuleFederation['loadRemote']>[1];

  const startedAt = Date.now();
  emitRuntimeHook(hooks, {
    kind: 'remote-load',
    manifestUrl,
    remoteAlias,
    remoteId,
    runtimeKey: getRuntimeKey(runtimeKey),
    stage: 'before',
    target: getDefaultTarget(target),
  });

  try {
    const registrationRecord = registration as Record<string, unknown>;
    const result = await loadRemoteWithRuntimeMetrics<T>(remoteId, runtimeLoadOptions, {
      entry: typeof registrationRecord.entry === 'string' ? registrationRecord.entry : undefined,
      manifestUrl,
      remoteAlias,
      remoteName: typeof registrationRecord.name === 'string' ? registrationRecord.name : undefined,
      registrationDurationMs,
      runtimeKey: getRuntimeKey(runtimeKey),
      shareScope:
        typeof registrationRecord.shareScope === 'string'
          ? registrationRecord.shareScope
          : shareScope || 'default',
      sourceUrl: findRegisteredManifestRemoteForDebug(
        remoteId,
        getDefaultTarget(target),
        runtimeKey,
      )?.sourceUrl,
      target: getDefaultTarget(target),
      totalStartedAt,
    });
    emitRuntimeHook(hooks, {
      durationMs: Date.now() - startedAt,
      kind: 'remote-load',
      manifestUrl,
      remoteAlias,
      remoteId,
      runtimeKey: getRuntimeKey(runtimeKey),
      stage: 'after',
      status: 'success',
      target: getDefaultTarget(target),
    });
    return result;
  } catch (error) {
    emitRuntimeHook(hooks, {
      durationMs: Date.now() - startedAt,
      error: getRuntimeErrorMessage(error),
      kind: 'remote-load',
      manifestUrl,
      remoteAlias,
      remoteId,
      runtimeKey: getRuntimeKey(runtimeKey),
      stage: 'error',
      status: 'failure',
      target: getDefaultTarget(target),
    });
    throw error;
  }
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
  debugState.manifestCircuitBreakers.clear();
  debugState.manifestFetches = [];
  debugState.manifestIntegrityChecks = [];
  debugState.manifestRequests.clear();
  debugState.manifestSourceUrls.clear();
  debugState.remoteLoadMetrics = [];
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
        manifestUrl: entry.manifestUrl || manifestUrl,
        name: entry.manifest.name,
        runtimeKey: entry.runtimeKey,
        sourceUrl: entry.sourceUrl,
      })),
      manifestCacheKeys: [...debugState.manifestCache.keys()],
      manifestCircuitBreakers: [...debugState.manifestCircuitBreakers.values()].map((entry) => ({
        ...entry,
      })),
      manifestFetches: debugState.manifestFetches.map((entry) => ({ ...entry })),
      manifestIntegrityChecks: debugState.manifestIntegrityChecks.map((entry) => ({ ...entry })),
      pendingManifestRequests: [...debugState.manifestRequests.keys()],
      pendingRemoteRegistrations: [...debugState.registrationRequests.keys()],
      remoteLoadMetrics: debugState.remoteLoadMetrics.map((entry) => ({ ...entry })),
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

function hasRuntimeKey(entry: { runtimeKey?: string }, runtimeKey: string) {
  return getRuntimeKey(entry.runtimeKey) === runtimeKey;
}

function keyBelongsToRuntimeKey(key: string, runtimeKey: string) {
  return key.startsWith(`${runtimeKey}:`);
}

export function getFederationRuntimeScopeDebugInfo(runtimeKey: string) {
  const normalizedRuntimeKey = getRuntimeKey(runtimeKey);
  const debugInfo = getFederationDebugInfo();

  return {
    ...debugInfo,
    runtime: {
      ...debugInfo.runtime,
      lastLoadError:
        debugInfo.runtime.lastLoadError &&
        hasRuntimeKey(debugInfo.runtime.lastLoadError, normalizedRuntimeKey)
          ? debugInfo.runtime.lastLoadError
          : null,
      manifestCache: debugInfo.runtime.manifestCache.filter((entry) =>
        hasRuntimeKey(entry, normalizedRuntimeKey),
      ),
      manifestCacheKeys: debugInfo.runtime.manifestCacheKeys.filter((key) =>
        keyBelongsToRuntimeKey(key, normalizedRuntimeKey),
      ),
      manifestCircuitBreakers: debugInfo.runtime.manifestCircuitBreakers.filter((entry) =>
        hasRuntimeKey(entry, normalizedRuntimeKey),
      ),
      manifestFetches: debugInfo.runtime.manifestFetches.filter((entry) =>
        hasRuntimeKey(entry, normalizedRuntimeKey),
      ),
      pendingManifestRequests: debugInfo.runtime.pendingManifestRequests.filter((key) =>
        keyBelongsToRuntimeKey(key, normalizedRuntimeKey),
      ),
      pendingRemoteRegistrations: debugInfo.runtime.pendingRemoteRegistrations.filter((key) =>
        keyBelongsToRuntimeKey(key, normalizedRuntimeKey),
      ),
      remoteLoadMetrics: debugInfo.runtime.remoteLoadMetrics.filter((entry) =>
        hasRuntimeKey(entry, normalizedRuntimeKey),
      ),
      registeredManifestRemotes: debugInfo.runtime.registeredManifestRemotes.filter((remote) =>
        hasRuntimeKey(remote, normalizedRuntimeKey),
      ),
    },
  };
}

function withRuntimeScope<T extends ManifestFetchOptions>(
  runtimeKey: string,
  options: T | undefined,
): T & { runtimeKey: string } {
  return {
    ...(options || ({} as T)),
    runtimeKey,
  };
}

export function createFederationRuntimeScope(runtimeKey: string) {
  const normalizedRuntimeKey = getRuntimeKey(runtimeKey);

  return {
    fetchFederationManifest: (manifestUrl: string, options?: ManifestFetchOptions) =>
      fetchFederationManifest(manifestUrl, withRuntimeScope(normalizedRuntimeKey, options)),
    getFederationDebugInfo: () => getFederationRuntimeScopeDebugInfo(normalizedRuntimeKey),
    loadRemoteFromManifest: <T>(
      remoteId: string,
      manifestUrl: string,
      options?: RegisterManifestRemoteOptions &
        Partial<NonNullable<Parameters<ModuleFederation['loadRemote']>[1]>>,
    ) =>
      loadRemoteFromManifest<T>(
        remoteId,
        manifestUrl,
        withRuntimeScope(normalizedRuntimeKey, options),
      ),
    refreshRemote: (remoteIdOrAlias: string, options?: RefreshRemoteOptions) =>
      refreshRemote(remoteIdOrAlias, withRuntimeScope(normalizedRuntimeKey, options)),
    registerManifestRemote: (
      remoteAlias: string,
      manifestUrl: string,
      options?: RegisterManifestRemoteOptions,
    ) =>
      registerManifestRemote(
        remoteAlias,
        manifestUrl,
        withRuntimeScope(normalizedRuntimeKey, options),
      ),
    runtimeKey: normalizedRuntimeKey,
    warmFederationRemotes: (
      remotes: Record<string, string | WarmFederationRemoteConfig> | WarmFederationRemoteConfig[],
      options?: RegisterManifestRemoteOptions,
    ) => warmFederationRemotes(remotes, withRuntimeScope(normalizedRuntimeKey, options)),
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
  const eventLimit =
    typeof devtoolsGlobal.eventLimit === 'number' ? devtoolsGlobal.eventLimit : MAX_DEVTOOLS_EVENTS;
  while (devtoolsGlobal.events.length > eventLimit) {
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
