import { createFilter } from '@rollup/pluginutils';
import { init as initEsLexer, parse as parseEsImports } from 'es-module-lexer';
import MagicString from 'magic-string';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'pathe';
import { fileURLToPath } from 'url';
import type { Plugin } from 'vite';
import {
  addCssAssetsToAllExports,
  collectCssAssets,
  createEmptyAssetMap,
  processModuleAssets,
} from '../utils/cssModuleHelpers';
import { mapCodeToCodeWithSourcemap } from '../utils/mapCodeToCodeWithSourcemap';
import type { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';
import { resolvePublicPath } from '../utils/publicPath';
import {
  generateExposes,
  generateRemoteEntry,
  generateSsrRemoteEntry,
  getExposesCssMapPlaceholder,
  getHostAutoInitPath,
  getSsrRemoteEntryFileName,
} from '../virtualModules';
import { parsePromise } from './pluginModuleParseEnd';

const filter: (id: string) => boolean = createFilter();

interface ProxyRemoteEntryParams {
  options: NormalizedModuleFederationOptions;
  remoteEntryId: string;
  ssrRemoteEntryId: string;
  virtualExposesId: string;
}

const DEV_NODE_TARGET_QUERY_KEY = 'mf_target';
const DEV_NODE_TARGET_QUERY_VALUE = 'node';
const STYLE_REQUEST_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss)$/i;
const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

function isBareSpecifier(requestPath: string) {
  return (
    !requestPath.startsWith('.') &&
    !requestPath.startsWith('/') &&
    !ABSOLUTE_URL_RE.test(requestPath)
  );
}

export default function ({
  options,
  remoteEntryId,
  ssrRemoteEntryId,
  virtualExposesId,
}: ProxyRemoteEntryParams): Plugin {
  let viteConfig: any, _command: string, root: string, devServer: any;
  let optimizeDepsMetadata:
    | {
        browserHash?: string;
        optimized?: Record<string, { file: string; needsInterop?: boolean; src: string }>;
      }
    | null
    | undefined;
  const shouldUseEagerExposeImports = () => Boolean(viteConfig?.build?.ssr);
  const getDevIdPrefix = () => `${viteConfig?.base || '/'}@id/`.replace(/\/{2,}/g, '/');
  const getSsrRemoteEntryRequestPaths = () => {
    const base = viteConfig?.base || '/';
    return new Set(
      [
        `${base}@id/${ssrRemoteEntryId}`,
        `${base}${getSsrRemoteEntryFileName(options.filename)}`,
      ].map((value) => value.replace(/\/{2,}/g, '/')),
    );
  };
  const toNodeTargetUrl = (origin: string, requestPath: string) => {
    const resolved = new URL(
      isBareSpecifier(requestPath) ? `/@id/${requestPath}` : requestPath,
      origin,
    );
    resolved.searchParams.set(DEV_NODE_TARGET_QUERY_KEY, DEV_NODE_TARGET_QUERY_VALUE);
    return resolved.toString();
  };
  const replaceAsync = async (
    input: string,
    matcher: RegExp,
    replacer: (...match: string[]) => Promise<string>,
  ) => {
    const matches = Array.from(input.matchAll(matcher));
    if (matches.length === 0) {
      return input;
    }

    let output = '';
    let lastIndex = 0;
    for (const match of matches) {
      const matchIndex = match.index ?? 0;
      output += input.slice(lastIndex, matchIndex);
      output += await replacer(...match);
      lastIndex = matchIndex + match[0].length;
    }
    output += input.slice(lastIndex);
    return output;
  };
  const rewriteStringLiteralImports = async (
    input: string,
    rewriter: (specifier: string) => Promise<string>,
  ) => {
    await initEsLexer;

    let imports;
    try {
      [imports] = parseEsImports(input);
    } catch {
      return input;
    }

    let magicString: MagicString | undefined;
    for (const imported of imports) {
      if (imported.d === -2 || !imported.n) {
        continue;
      }

      const rewrittenSpecifier = await rewriter(imported.n);
      if (rewrittenSpecifier === imported.n) {
        continue;
      }

      magicString ??= new MagicString(input);
      magicString.overwrite(
        imported.s,
        imported.e,
        imported.d >= 0 ? JSON.stringify(rewrittenSpecifier) : rewrittenSpecifier,
      );
    }

    return magicString ? magicString.toString() : input;
  };
  const getOptimizeDepsMetadata = () => {
    if (optimizeDepsMetadata !== undefined) {
      return optimizeDepsMetadata;
    }

    const metadataPath = path.resolve(root, 'node_modules/.vite/deps/_metadata.json');
    if (!existsSync(metadataPath)) {
      optimizeDepsMetadata = null;
      return optimizeDepsMetadata;
    }

    optimizeDepsMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    return optimizeDepsMetadata;
  };
  const getOptimizedDepRequestInfo = (requestPath: string) => {
    const metadata = getOptimizeDepsMetadata();
    if (!metadata?.optimized) {
      return null;
    }

    const querySuffix = metadata.browserHash ? `?v=${metadata.browserHash}` : '';
    const directMatch = metadata.optimized[requestPath];
    if (directMatch?.file) {
      return {
        needsInterop: Boolean(directMatch.needsInterop),
        path: `/node_modules/.vite/deps/${directMatch.file}${querySuffix}`,
      };
    }

    const fileSystemRequestPath = requestPath.startsWith('/@fs/')
      ? requestPath.replace(/^\/@fs/, '')
      : requestPath;
    if (!path.isAbsolute(fileSystemRequestPath)) {
      return null;
    }

    const depsDir = path.resolve(root, 'node_modules/.vite/deps');
    for (const optimizedDep of Object.values(metadata.optimized)) {
      const optimizedSourcePath = path.resolve(depsDir, optimizedDep.src);
      if (optimizedSourcePath === fileSystemRequestPath) {
        return {
          needsInterop: Boolean(optimizedDep.needsInterop),
          path: `/node_modules/.vite/deps/${optimizedDep.file}${querySuffix}`,
        };
      }
    }

    return null;
  };
  const toNodeTargetRequestPath = (requestPath: string) => {
    const optimizedDepInfo = getOptimizedDepRequestInfo(requestPath);
    if (optimizedDepInfo) {
      return optimizedDepInfo.path;
    }

    if (requestPath.startsWith('/@fs/') || requestPath.startsWith('/@id/')) {
      return requestPath;
    }
    if (requestPath.startsWith('/node_modules/')) {
      return requestPath;
    }
    if (
      path.isAbsolute(requestPath) &&
      ((root && requestPath.startsWith(root)) || requestPath.includes('/node_modules/'))
    ) {
      return `/@fs${requestPath}`;
    }
    if (requestPath.startsWith('/')) {
      return requestPath;
    }
    if (requestPath.startsWith('virtual:')) {
      return `/@id/${requestPath}`;
    }
    if (isBareSpecifier(requestPath)) {
      return `/@id/${requestPath}`;
    }
    return requestPath;
  };
  const resolveNodeTargetSpecifier = async (
    origin: string,
    requestPath: string,
    importerId: string,
  ) => {
    const optimizedDepInfo = getOptimizedDepRequestInfo(requestPath);
    if (optimizedDepInfo) {
      return {
        needsInterop: optimizedDepInfo.needsInterop,
        url: toNodeTargetUrl(origin, optimizedDepInfo.path),
      };
    }

    if (isBareSpecifier(requestPath)) {
      const resolvedImporterId = importerId.startsWith('/@fs/')
        ? importerId.replace(/^\/@fs/, '')
        : importerId;
      const resolved = await devServer.pluginContainer.resolveId(requestPath, resolvedImporterId, {
        ssr: true,
      });
      return {
        needsInterop: false,
        url: toNodeTargetUrl(origin, toNodeTargetRequestPath(resolved?.id || requestPath)),
      };
    }

    return {
      needsInterop: false,
      url: toNodeTargetUrl(origin, toNodeTargetRequestPath(requestPath)),
    };
  };
  const normalizeNodeTargetModuleCode = async (
    code: string,
    origin: string,
    importerId: string,
  ) => {
    const exportStatements: string[] = [];
    let exportAliasIndex = 0;
    const normalizeNodeTargetExports = (input: string) =>
      input
        .split('\n')
        .flatMap((line) => {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith('export {') || trimmedLine.includes('} from ')) {
            return [line];
          }

          const exportMatch = trimmedLine.match(/^export\s*\{\s*([^}]+)\s*\};?$/);
          if (!exportMatch) {
            return [line];
          }

          const specifiers = exportMatch[1]
            .split(',')
            .map((specifier) => specifier.trim())
            .filter(Boolean);
          const aliasDeclarations: string[] = [];
          const normalizedSpecifiers = specifiers.map((specifier) => {
            const parts = specifier.split(/\s+as\s+/);
            const localExpression = parts[0]?.trim();
            const exportName = (parts[1] || parts[0])?.trim();
            if (!localExpression || !exportName || /^[A-Za-z_$][\w$]*$/.test(localExpression)) {
              return specifier;
            }

            const localAlias = `__mf_export_${exportAliasIndex++}__`;
            aliasDeclarations.push(`const ${localAlias} = ${localExpression};`);
            return `${localAlias} as ${exportName}`;
          });

          if (aliasDeclarations.length === 0) {
            return [line];
          }

          return [...aliasDeclarations, `export { ${normalizedSpecifiers.join(', ')} };`];
        })
        .join('\n');
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

    normalized = await replaceAsync(
      normalized,
      /await\s+__vite_ssr_import__\("([^"]+)"(?:,\s*\{[^)]*\})?\)/g,
      async (_match, requestPath: string) => {
        const resolved = await resolveNodeTargetSpecifier(origin, requestPath, importerId);
        const importExpression = `import(${JSON.stringify(resolved.url)})`;
        return resolved.needsInterop
          ? `await ${importExpression}.then((mod) => mod.default ?? mod)`
          : `await ${importExpression}`;
      },
    );
    normalized = await replaceAsync(
      normalized,
      /__vite_ssr_dynamic_import__\("([^"]+)"\)/g,
      async (_match, requestPath: string) => {
        const resolved = await resolveNodeTargetSpecifier(origin, requestPath, importerId);
        const importExpression = `import(${JSON.stringify(resolved.url)})`;
        return resolved.needsInterop
          ? `${importExpression}.then((mod) => mod.default ?? mod)`
          : importExpression;
      },
    );
    normalized = normalized
      .replace(/\b__vite_ssr_import_meta__\.url\b/g, 'import.meta.url')
      .replace(/\b__vite_ssr_import_meta__\b/g, 'import.meta');
    normalized = normalizeNodeTargetExports(normalized).replace(
      /export\s*\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s+as\s+([A-Za-z_$][\w$]*)\s*\};?/g,
      (_statement, localExpression: string, exportName: string) => {
        const localAlias = `__mf_export_${exportAliasIndex++}__`;
        return `const ${localAlias} = ${localExpression};\nexport { ${localAlias} as ${exportName} };`;
      },
    );

    normalized = await rewriteStringLiteralImports(normalized, async (target) => {
      if (ABSOLUTE_URL_RE.test(target)) {
        return target;
      }
      return (await resolveNodeTargetSpecifier(origin, target, importerId)).url;
    });

    if (exportStatements.length > 0) {
      normalized = `${normalized.trim()}\n${exportStatements.join('\n')}\n`;
    }

    return normalized;
  };

  return {
    name: 'proxyRemoteEntry',
    enforce: 'post',
    configResolved(config) {
      viteConfig = config;
      root = config.root;
    },
    config(config, { command }) {
      _command = command;
    },
    configureServer(server) {
      devServer = server;
      if (Object.keys(options.exposes).length === 0) return;

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url;
        if (!rawUrl) {
          next();
          return;
        }

        const host =
          req.headers.host ||
          `${server.config.server.host || 'localhost'}:${server.config.server.port || 5173}`;
        const protocol = server.config.server.https ? 'https' : 'http';
        const origin = `${protocol}://${host}`;
        const requestUrl = new URL(rawUrl, origin);
        const requestPath = decodeURIComponent(requestUrl.pathname);
        const isNodeTargetRequest =
          requestUrl.searchParams.get(DEV_NODE_TARGET_QUERY_KEY) === DEV_NODE_TARGET_QUERY_VALUE;

        if (!isNodeTargetRequest && !getSsrRemoteEntryRequestPaths().has(requestPath)) {
          next();
          return;
        }

        const transformTargetId = await (async () => {
          if (getSsrRemoteEntryRequestPaths().has(requestPath)) {
            return ssrRemoteEntryId;
          }
          const devIdPrefix = getDevIdPrefix();
          if (requestPath.startsWith(devIdPrefix)) {
            const decodedId = requestPath.slice(devIdPrefix.length);
            if (decodedId.startsWith('virtual:')) {
              return decodedId;
            }
            if (isBareSpecifier(decodedId)) {
              const resolved = await devServer.pluginContainer.resolveId(decodedId, undefined, {
                ssr: true,
              });
              if (resolved?.id) {
                return resolved.id;
              }
            }
            return requestPath;
          }
          return requestPath;
        })();

        if (STYLE_REQUEST_RE.test(requestPath)) {
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end('export default {};');
          return;
        }

        const transformed = await server.transformRequest(transformTargetId, { ssr: true });
        if (!transformed?.code) {
          next();
          return;
        }

        const code = await normalizeNodeTargetModuleCode(
          transformed.code,
          origin,
          transformTargetId,
        );

        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(code);
      });
    },
    async buildStart() {
      // Emit each exposed module as a chunk entry so the bundler properly
      // code-splits shared dependencies away from the main entry's side effects.
      // Without this, the bundler may merge exposed modules into the main entry
      // chunk, causing the host to execute the remote's bootstrap code (e.g.
      // createApp().mount()) when loading an exposed component.
      if (_command !== 'build') return;
      for (const expose of Object.values(options.exposes)) {
        const resolved = await this.resolve(expose.import);
        if (resolved) {
          this.emitFile({
            type: 'chunk',
            id: resolved.id,
          });
        }
      }
    },
    async resolveId(id: string, importer?: string) {
      if (id === remoteEntryId) {
        return remoteEntryId;
      }
      if (id === ssrRemoteEntryId) {
        return ssrRemoteEntryId;
      }
      if (id === virtualExposesId) {
        return virtualExposesId;
      }
      if (_command === 'serve' && id.includes(getHostAutoInitPath())) {
        return id;
      }
      // When the virtual remote entry imports a bare specifier (e.g. a runtime
      // plugin like "@module-federation/dts-plugin/dynamic-remote-type-hints-plugin"),
      // Vite cannot resolve it from the consumer project root under strict package
      // managers (pnpm) because it is a transitive dependency.  Re-resolve from
      // this package's location so Vite uses the correct ESM entry point.
      if (
        (importer === remoteEntryId || importer === ssrRemoteEntryId) &&
        !id.startsWith('.') &&
        !id.startsWith('/') &&
        !id.startsWith('\0') &&
        !id.startsWith('virtual:')
      ) {
        const importPath =
          typeof __filename === 'string' ? __filename : fileURLToPath(import.meta.url);
        const resolved = await this.resolve(id, importPath, { skipSelf: true });
        if (resolved) return resolved;
      }
    },
    load(id: string) {
      if (id === remoteEntryId) {
        return parsePromise.then((_) => generateRemoteEntry(options, virtualExposesId, _command));
      }
      if (id === ssrRemoteEntryId) {
        return parsePromise.then((_) => generateSsrRemoteEntry(options, virtualExposesId));
      }
      if (id === virtualExposesId) {
        return generateExposes(options, {
          eagerImports: shouldUseEagerExposeImports(),
        });
      }
      if (_command === 'serve' && id.includes(getHostAutoInitPath())) {
        return id;
      }
    },
    transform(code: string, id: string) {
      const transformedCode = (() => {
        if (!filter(id)) return;
        if (id.includes(remoteEntryId)) {
          return parsePromise.then((_) => generateRemoteEntry(options, virtualExposesId, _command));
        }
        if (id.includes(ssrRemoteEntryId)) {
          return parsePromise.then((_) => generateSsrRemoteEntry(options, virtualExposesId));
        }
        if (id === virtualExposesId) {
          return generateExposes(options, {
            eagerImports: shouldUseEagerExposeImports(),
          });
        }
        if (id.includes(getHostAutoInitPath())) {
          if (_command === 'serve') {
            const host =
              typeof viteConfig.server?.host === 'string' && viteConfig.server.host !== '0.0.0.0'
                ? viteConfig.server.host
                : 'localhost';
            const publicPath = JSON.stringify(
              resolvePublicPath(options, viteConfig.base) + options.filename,
            );
            return `
          if (typeof window !== 'undefined') {
            const origin = (${!options.ignoreOrigin}) ? window.origin : "//${host}:${viteConfig.server?.port}"
            const remoteEntry = await import(origin + ${publicPath})
            await remoteEntry.init()
          }
          `;
          }
          return code;
        }
      })();

      return mapCodeToCodeWithSourcemap(transformedCode);
    },
    generateBundle(_, bundle) {
      if (_command !== 'build') return;

      const filesMap: Record<
        string,
        {
          js: { sync: string[]; async: string[] };
          css: { sync: string[]; async: string[] };
        }
      > = {};
      const exposeEntries = Object.entries(options.exposes);
      const allCssAssets = options.bundleAllCSS ? collectCssAssets(bundle) : new Set<string>();

      processModuleAssets(bundle, filesMap, (modulePath) => {
        const absoluteModulePath = path.resolve(root, modulePath);
        const matchedExpose = exposeEntries.find(([_, exposeOptions]) => {
          const exposePath = path.resolve(root, exposeOptions.import);
          if (absoluteModulePath === exposePath) {
            return true;
          }

          const stripKnownJsExt = (filePath: string) => {
            const ext = path.extname(filePath);
            return ['.ts', '.tsx', '.jsx', '.mjs', '.cjs'].includes(ext)
              ? path.join(path.dirname(filePath), path.basename(filePath, ext))
              : filePath;
          };

          return stripKnownJsExt(absoluteModulePath) === stripKnownJsExt(exposePath);
        });

        return matchedExpose?.[1].import;
      });

      if (options.bundleAllCSS) {
        addCssAssetsToAllExports(filesMap, allCssAssets);
      }

      const ensureRelativeImportPath = (fromFile: string, toFile: string) => {
        let relativePath = path.relative(path.dirname(fromFile), toFile);
        if (!relativePath.startsWith('.')) {
          relativePath = `./${relativePath}`;
        }
        return relativePath;
      };

      const placeholderValue = getExposesCssMapPlaceholder();
      const placeholderPatterns = [
        JSON.stringify(placeholderValue),
        `'${placeholderValue}'`,
        `\`${placeholderValue}\``,
      ];
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk' || !file.code.includes(placeholderValue)) continue;

        // virtualExposes can be wrapped into helper chunks, so patch every chunk
        // that still carries the placeholder.
        const cssAssetMap = exposeEntries.reduce<Record<string, string[]>>(
          (acc, [exposeKey, expose]) => {
            const assets = filesMap[expose.import] || createEmptyAssetMap();
            acc[exposeKey] = [...assets.css.sync, ...assets.css.async].map((cssAsset) =>
              ensureRelativeImportPath(file.fileName, cssAsset),
            );
            return acc;
          },
          {},
        );

        for (const placeholderPattern of placeholderPatterns) {
          file.code = file.code.replace(placeholderPattern, JSON.stringify(cssAssetMap));
        }
      }
    },
  };
}
