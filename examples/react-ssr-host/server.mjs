import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectFederationManifestPreloadLinks } from 'vite-plugin-federation/runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, 'dist', 'client');
const clientManifestPath = path.join(clientDir, '.vite', 'manifest.json');
const serverEntryPath = path.join(__dirname, 'dist', 'server', 'server-entry.js');
const defaultRemoteManifestUrl =
  process.env.REACT_REMOTE_MANIFEST_URL || 'http://localhost:4174/mf-manifest.json';
const defaultRemoteManifestFallbackUrls = (process.env.REACT_REMOTE_MANIFEST_FALLBACK_URLS || '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const allowManifestQueryOverrides = process.env.REACT_REMOTE_MANIFEST_QUERY_OVERRIDES === '1';
const port = Number(process.env.PORT || 4180);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/\u2028/g, '\\u2028');
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getHttpStatusCode(error) {
  const statusCode = error && typeof error === 'object' ? error.statusCode : undefined;
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
}

function getAllowedManifestOrigins() {
  const configuredOrigins = (process.env.REACT_REMOTE_MANIFEST_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const manifestUrls = [
    defaultRemoteManifestUrl,
    ...defaultRemoteManifestFallbackUrls,
    ...configuredOrigins,
  ];

  return new Set(
    manifestUrls.map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        throw createHttpError(500, `Invalid SSR manifest allowlist URL or origin: ${value}`);
      }
    }),
  );
}

const allowedManifestOrigins = getAllowedManifestOrigins();

function normalizeManifestOverrideUrl(rawUrl, parameterName) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw createHttpError(400, `Invalid ${parameterName} query parameter.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw createHttpError(400, `${parameterName} must use http: or https:.`);
  }

  if (!allowedManifestOrigins.has(url.origin)) {
    throw createHttpError(400, `${parameterName} origin is not allowed: ${url.origin}`);
  }

  return url.href;
}

function collectClientEntryAssets(manifest, entryKey, seen = new Set()) {
  const entry = manifest[entryKey];
  if (!entry) {
    throw new Error(`Unable to find "${entryKey}" in client manifest.`);
  }

  if (seen.has(entryKey)) {
    return {
      css: new Set(),
      js: new Set(),
    };
  }
  seen.add(entryKey);

  const css = new Set(entry.css || []);
  const js = new Set(entry.imports || []);

  for (const importedKey of entry.imports || []) {
    const nestedAssets = collectClientEntryAssets(manifest, importedKey, seen);
    nestedAssets.css.forEach((asset) => css.add(asset));
    nestedAssets.js.forEach((asset) => js.add(asset));
  }

  return { css, js };
}

async function serveStaticFile(reqPath, res) {
  const filePath = path.join(clientDir, reqPath);
  if (!filePath.startsWith(clientDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return false;
    }
    const ext = path.extname(filePath);
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function getRequestFederationConfig(requestUrl) {
  const manifestUrlOverride = requestUrl.searchParams.get('manifestUrl');
  const fallbackUrlOverrides = requestUrl.searchParams.getAll('fallbackUrl');
  const hasUrlOverrides = Boolean(manifestUrlOverride) || fallbackUrlOverrides.length > 0;

  if (hasUrlOverrides && !allowManifestQueryOverrides) {
    throw createHttpError(
      400,
      'SSR manifest URL query overrides are disabled. Configure server-side manifest URLs instead.',
    );
  }

  return {
    fallbackUrls:
      fallbackUrlOverrides.length > 0
        ? fallbackUrlOverrides.map((url) => normalizeManifestOverrideUrl(url, 'fallbackUrl'))
        : defaultRemoteManifestFallbackUrls,
    force: requestUrl.searchParams.get('forceManifest') === '1',
    manifestUrl: manifestUrlOverride
      ? normalizeManifestOverrideUrl(manifestUrlOverride, 'manifestUrl')
      : defaultRemoteManifestUrl,
  };
}

async function proxyRemoteAsset(reqPath, res) {
  if (!reqPath.startsWith('assets/')) {
    return false;
  }

  const remoteAssetUrl = new URL(reqPath, defaultRemoteManifestUrl);

  try {
    const response = await fetch(remoteAssetUrl);
    if (!response.ok) {
      return false;
    }

    const ext = path.extname(reqPath);
    const contentLength = response.headers.get('content-length');
    const headers = {
      'Content-Type':
        response.headers.get('content-type') || MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control':
        response.headers.get('cache-control') || 'public, max-age=31536000, immutable',
    };

    if (contentLength) {
      headers['Content-Length'] = contentLength;
    }

    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

async function renderDocument(requestUrl) {
  const {
    fallbackUrls,
    force,
    manifestUrl: remoteManifestUrl,
  } = getRequestFederationConfig(requestUrl);
  const [{ render }, clientManifest] = await Promise.all([
    import(pathToFileURL(serverEntryPath).href),
    readFile(clientManifestPath, 'utf-8').then((content) => JSON.parse(content)),
  ]);

  const [{ appHtml, buttonProps, federationDebug, remoteManifest }, clientAssets] =
    await Promise.all([
      render(remoteManifestUrl, {
        fallbackUrls,
        force,
      }),
      Promise.resolve(collectClientEntryAssets(clientManifest, 'index.html')),
    ]);
  const remoteManifestSourceUrl = federationDebug.registeredRemote?.sourceUrl || remoteManifestUrl;

  const remotePreloadLinks = collectFederationManifestPreloadLinks(
    remoteManifestSourceUrl,
    remoteManifest,
    './Button',
  );
  const ssrFederationDebug = {
    ...federationDebug,
    preloadLinks: remotePreloadLinks.map((link) => ({
      assetType: link.assetType,
      crossorigin: link.crossorigin,
      exposePath: link.exposePath,
      href: link.href,
      loading: link.loading,
      rel: link.rel,
    })),
    fallbackUrls,
    manifestSourceUrl: remoteManifestSourceUrl,
  };
  const entry = clientManifest['index.html'];

  const clientCssLinks = [...clientAssets.css]
    .map((asset) => `<link rel="stylesheet" href="/${escapeHtml(asset)}" />`)
    .join('\n');
  const clientPreloadLinks = [...clientAssets.js]
    .map(
      (asset) => `<link rel="modulepreload" href="/${escapeHtml(clientManifest[asset].file)}" />`,
    )
    .join('\n');
  const remoteAssetLinks = remotePreloadLinks
    .map((link) => {
      const href = escapeHtml(link.href);
      if (link.rel === 'stylesheet') {
        return `<link rel="stylesheet" data-mf-href="${href}" href="${href}" />`;
      }

      const crossorigin = link.crossorigin ? ` crossorigin="${escapeHtml(link.crossorigin)}"` : '';
      return `<link rel="modulepreload"${crossorigin} href="${href}" />`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>react-ssr-host</title>
    ${clientCssLinks}
    ${remoteAssetLinks}
    ${clientPreloadLinks}
  </head>
  <body>
    <div id="root">${appHtml}</div>
    <script>
      window.__REMOTE_MANIFEST_URL__ = ${serializeForInlineScript(remoteManifestUrl)};
      window.__REMOTE_MANIFEST_FALLBACK_URLS__ = ${serializeForInlineScript(fallbackUrls)};
      window.__REMOTE_BUTTON_PROPS__ = ${serializeForInlineScript(buttonProps)};
      window.__SSR_FEDERATION_DEBUG__ = ${serializeForInlineScript(ssrFederationDebug)};
    </script>
    <script type="module" src="/${entry.file}"></script>
  </body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  if (pathname !== '/') {
    const served = await serveStaticFile(pathname.slice(1), res);
    if (served) return;
    const proxied = await proxyRemoteAsset(pathname.slice(1), res);
    if (proxied) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  try {
    const html = await renderDocument(requestUrl);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (error) {
    const statusCode = getHttpStatusCode(error);
    res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      error instanceof Error && statusCode >= 500 ? error.stack || error.message : String(error),
    );
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[react-ssr-host] listening on http://127.0.0.1:${port}`);
  console.log(`[react-ssr-host] remote manifest: ${defaultRemoteManifestUrl}`);
});
