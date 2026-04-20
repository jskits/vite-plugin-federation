import type { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';

const EXPOSES_CSS_MAP_PLACEHOLDER = '__MF_EXPOSES_CSS_MAP__';

export function getExposesCssMapPlaceholder() {
  return EXPOSES_CSS_MAP_PLACEHOLDER;
}

export function getVirtualExposesId(
  options: Pick<NormalizedModuleFederationOptions, 'internalName' | 'filename'>,
) {
  const scopedKey = `${options.internalName}__${options.filename}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `virtual:mf-exposes:${scopedKey}`;
}

export function generateExposes(
  options: NormalizedModuleFederationOptions,
  buildOptions: {
    eagerImports?: boolean;
  } = {},
) {
  const cssBucketKeyPrefix = `css__${options.name}__`;
  const eagerImports = buildOptions.eagerImports === true;
  const exposeEntries = Object.entries(options.exposes);
  const staticImports = eagerImports
    ? exposeEntries
        .map(
          ([, expose], index) =>
            `import * as __mf_expose_${index} from ${JSON.stringify(expose.import)};`,
        )
        .join('\n')
    : '';
  return `
    ${staticImports}
    const cssAssetMap = ${JSON.stringify(options.bundleAllCSS ? EXPOSES_CSS_MAP_PLACEHOLDER : {})};
    const injectedCssHrefs = new Set();
    let exposeLoadQueue = Promise.resolve();

    async function importExposedModule(loader) {
      const currentLoad = exposeLoadQueue.then(loader, loader);
      exposeLoadQueue = currentLoad.then(
        () => undefined,
        () => undefined
      );
      return currentLoad;
    }

    async function handleCssAssets(exposeKey, injectMode) {
      // Replaced at build time with expose -> css asset paths.
      const cssAssets = cssAssetMap[exposeKey] || [];

      const hrefs = cssAssets.map((cssAsset) => new URL(cssAsset, import.meta.url).href);

      if (injectMode === "none") {
        return;
      }

      if (injectMode === "manual") {
        globalThis[${JSON.stringify(cssBucketKeyPrefix)} + exposeKey] = hrefs;
        return;
      }

      if (typeof document === "undefined") {
        return;
      }

      await Promise.all(
        hrefs.map((href) => {

          // Same expose can be resolved multiple times in one page.
          if (injectedCssHrefs.has(href)) {
            return Promise.resolve();
          }
          injectedCssHrefs.add(href);

          const existingLink = document.querySelector(
            \`link[rel="stylesheet"][data-mf-href="\${href}"]\`
          );
          if (existingLink) {
            return Promise.resolve();
          }

          return new Promise((resolve, reject) => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = href;
            link.setAttribute("data-mf-href", href);
            link.onload = () => resolve();
            link.onerror = () => reject(new Error(\`[Module Federation] Failed to load CSS asset: \${href}\`));
            document.head.appendChild(link);
          });
        })
      );
    }

    export default {
    ${exposeEntries
      .map(([key], index) => {
        const injectMode = options.exposes[key].css?.inject || 'head';
        const importStatement = eagerImports
          ? `Promise.resolve(__mf_expose_${index})`
          : `importExposedModule(
            () => import(${JSON.stringify(options.exposes[key].import)})
          )`;
        return `
        ${JSON.stringify(key)}: async () => {
          await handleCssAssets(${JSON.stringify(key)}, ${JSON.stringify(injectMode)})
          const importModule = await ${importStatement}
          const exportModule = {}
          Object.assign(exportModule, importModule)
          Object.defineProperty(exportModule, "__esModule", {
            value: true,
            enumerable: false
          })
          return exportModule
        }
      `;
      })
      .join(',')}
  }
  `;
}
