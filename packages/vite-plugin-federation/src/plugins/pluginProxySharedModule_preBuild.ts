import { existsSync, readFileSync } from 'fs';
import path from 'pathe';
import type { Plugin, ResolvedConfig, UserConfig } from 'vite';
import { mfWarn } from '../utils/logger';
import { mapCodeToCodeWithSourcemap } from '../utils/mapCodeToCodeWithSourcemap';
import {
  findNodeModulesSuffixSharedMatch,
  type NormalizedShared,
  type ShareItem,
} from '../utils/normalizeModuleFederationOptions';
import {
  getIsRolldown,
  getPackageDetectionCwd,
  hasPackageDependency,
  removePathFromNpmPackage,
  setPackageDetectionCwd,
} from '../utils/packageUtils';
import { PromiseStore } from '../utils/PromiseStore';
import type VirtualModule from '../utils/VirtualModule';
import { assertModuleFound } from '../utils/VirtualModule';
import {
  addUsedShares,
  getConcreteSharedImportSource,
  generateLocalSharedImportMap,
  getPreBuildShareItem,
  getLoadShareModulePath,
  getLocalSharedImportMapPath,
  PREBUILD_TAG,
  writeLoadShareModule,
  writeLocalSharedImportMap,
  writePreBuildLibPath,
} from '../virtualModules';
import { parsePromise } from './pluginModuleParseEnd';

function getPrebuildResolutionSource(pkgName: string, shareItem?: ShareItem): string {
  return getConcreteSharedImportSource(pkgName, shareItem) || pkgName;
}

/**
 * Reads the dependencies of an installed package from its package.json.
 */
function getPackageDependencies(pkg: string): string[] {
  const packageName = removePathFromNpmPackage(pkg);
  const cwd = getPackageDetectionCwd();
  const candidates = [path.join(cwd, 'node_modules', packageName, 'package.json')];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const json = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          dependencies?: Record<string, string>;
        };
        return Object.keys(json.dependencies || {});
      } catch {
        // skip
      }
    }
  }
  return [];
}

/**
 * In dev mode, detects shared packages that are sub-dependencies of other
 * shared packages and removes them to avoid initialization order issues.
 * For example, `lit` depends on `lit-html`, `lit-element`, and
 * `@lit/reactive-element` — sharing them separately causes the child modules
 * to load before their parent, resulting in `undefined` class extends errors.
 */
function excludeSharedSubDependencies(shared: NormalizedShared): void {
  const sharedKeys = new Set(Object.keys(shared));

  for (const parentKey of sharedKeys) {
    const deps = getPackageDependencies(parentKey);
    for (const dep of deps) {
      if (sharedKeys.has(dep) && dep !== parentKey) {
        mfWarn(
          `"${dep}" is a dependency of shared package "${parentKey}" and is also shared separately. ` +
            `This may cause initialization order issues in dev mode. ` +
            `Consider sharing only "${parentKey}".\n` +
            `  Auto-excluding "${dep}" from shared modules for dev mode.`,
        );
        delete shared[dep];
        sharedKeys.delete(dep);
      }
    }
  }
}

export function proxySharedModule(options: {
  shared?: NormalizedShared;
  include?: string | string[];
  exclude?: string | string[];
}): Plugin[] {
  const { shared = {} } = options;
  let _config: ResolvedConfig | undefined;
  let _command = 'serve';
  let useDirectReactImport = false;
  const savePrebuild = new PromiseStore<string>();
  const getProxyableSharedKeys = () =>
    Object.keys(shared).filter((key) => !(useDirectReactImport && key === 'react'));
  const findMatchingSharedKey = (source: string) => {
    let prefixMatch: { key: string; proxyable: boolean; request: string } | undefined;

    for (const key of getProxyableSharedKeys()) {
      const keyBase = key.endsWith('/') ? key.slice(0, -1) : key;
      if (source === keyBase) {
        return { key, proxyable: true, request: source };
      }

      if (key.endsWith('/') && source.startsWith(`${keyBase}/`)) {
        prefixMatch ||= { key, proxyable: true, request: source };
      }
    }

    if (prefixMatch) return prefixMatch;

    const suffixMatch = findNodeModulesSuffixSharedMatch(source, shared);
    return suffixMatch ? { ...suffixMatch, proxyable: true } : undefined;
  };

  return [
    {
      name: 'generateLocalSharedImportMap',
      enforce: 'post',
      load(id) {
        if (id.includes(getLocalSharedImportMapPath())) {
          return parsePromise.then((_) => generateLocalSharedImportMap());
        }
      },
      transform(_, id) {
        if (id.includes(getLocalSharedImportMapPath())) {
          return mapCodeToCodeWithSourcemap(
            parsePromise.then((_) => generateLocalSharedImportMap()),
          );
        }
      },
    },
    {
      name: 'proxyPreBuildShared',
      enforce: 'pre',
      config(config: UserConfig, { command }) {
        const root = config.root || process.cwd();
        setPackageDetectionCwd(root);
        const isVinext = hasPackageDependency('vinext');
        const isAstro = hasPackageDependency('astro');
        _command = command;
        useDirectReactImport = isVinext || isAstro;

        if (command === 'serve') {
          excludeSharedSubDependencies(shared);
        }
      },
      async resolveId(source, importer, resolveOptions) {
        if (source.includes(PREBUILD_TAG)) {
          const module = assertModuleFound(PREBUILD_TAG, source) as VirtualModule;
          const pkgName = module.name;
          const importSource = getPrebuildResolutionSource(pkgName, getPreBuildShareItem(pkgName));
          const resolved = await (this as any).resolve(importSource, importer, { skipSelf: true });
          if (!resolved?.id) return;
          const result = resolved.id;

          if (_config && !result.includes(_config.cacheDir)) {
            // Save the non-prebundled source id so localSharedImportMap can import
            // the stable workspace path even after Vite optimizes the dependency.
            savePrebuild.set(pkgName, Promise.resolve(result));
            return (this as any).resolve(result, importer, { skipSelf: true });
          }

          return resolved;
        }

        if (/\.css$/.test(source)) return;
        if (useDirectReactImport && source === 'react') return;
        if (importer && importer.includes('localSharedImportMap')) return;
        if ((resolveOptions as { scan?: boolean } | undefined)?.scan) return;

        const isRolldown = getIsRolldown(this);
        const matchedShared = findMatchingSharedKey(source);
        if (!matchedShared?.proxyable) return;

        const shareItem = shared[matchedShared.key];
        const shareRequest = matchedShared.request;
        const loadSharePath = getLoadShareModulePath(shareRequest, isRolldown, _command);
        writeLoadShareModule(shareRequest, shareItem, _command, isRolldown);
        if (shareItem.shareConfig.import !== false) {
          writePreBuildLibPath(shareRequest, shareItem);
        }
        addUsedShares(shareRequest);
        writeLocalSharedImportMap();
        return (this as any).resolve(loadSharePath, importer, { skipSelf: true });
      },
      configResolved(config) {
        _config = config;

        // Write virtual module files and register shares eagerly.
        // The deadlock that previously occurred here (localSharedImportMap
        // referencing prebuild modules → Vite re-optimization → deadlock)
        // is now prevented by adding prebuild IDs to optimizeDeps.include
        // in the config hook (createEarlyVirtualModulesPlugin), so Vite
        // pre-bundles them upfront without triggering re-optimization.
        const isRolldown = getIsRolldown(this);
        Object.keys(shared).forEach((key) => {
          if (key.endsWith('/')) return;
          if (useDirectReactImport && key === 'react') {
            addUsedShares(key);
            return;
          }
          writeLoadShareModule(key, shared[key], _command, isRolldown);
          // Skip prebuild for shared deps with import: false — the host must
          // provide them, so no local fallback source is needed.
          if (shared[key].shareConfig.import !== false) {
            writePreBuildLibPath(key, shared[key]);
          }
          addUsedShares(key);
        });
        writeLocalSharedImportMap();
      },
    },
  ];
}
