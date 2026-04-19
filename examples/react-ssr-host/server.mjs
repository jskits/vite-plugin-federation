import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, 'dist', 'client');
const clientManifestPath = path.join(clientDir, '.vite', 'manifest.json');
const serverEntryPath = path.join(__dirname, 'dist', 'server', 'server-entry.js');
const remoteManifestUrl =
  process.env.REACT_REMOTE_MANIFEST_URL || 'http://localhost:4174/mf-manifest.json';
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
  return JSON.stringify(value).replace(/</g, '\\u003C').replace(/\u2028/g, '\\u2028');
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

function resolveRemoteAssetUrl(remoteManifestUrl, remoteManifest, assetPath) {
  const publicPath = remoteManifest.metaData?.publicPath;
  if (publicPath && publicPath !== 'auto') {
    return new URL(assetPath, new URL(publicPath, remoteManifestUrl)).toString();
  }
  return new URL(assetPath, remoteManifestUrl).toString();
}

function collectRemoteExposeAssets(remoteManifest, remoteManifestUrl, exposePath) {
  const expose = remoteManifest.exposes?.find((item) => item.path === exposePath);
  if (!expose) {
    throw new Error(`Unable to find expose "${exposePath}" in remote manifest.`);
  }

  const css = new Set(
    [...(expose.assets?.css?.sync || []), ...(expose.assets?.css?.async || [])].map((asset) =>
      resolveRemoteAssetUrl(remoteManifestUrl, remoteManifest, asset)
    )
  );
  const js = new Set(
    [...(expose.assets?.js?.sync || [])].map((asset) =>
      resolveRemoteAssetUrl(remoteManifestUrl, remoteManifest, asset)
    )
  );

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

async function renderDocument() {
  const [{ render }, clientManifest] = await Promise.all([
    import(pathToFileURL(serverEntryPath).href),
    readFile(clientManifestPath, 'utf-8').then((content) => JSON.parse(content)),
  ]);

  const [{ appHtml, buttonProps, remoteManifest }, clientAssets] = await Promise.all([
    render(remoteManifestUrl),
    Promise.resolve(collectClientEntryAssets(clientManifest, 'index.html')),
  ]);

  const remoteAssets = collectRemoteExposeAssets(remoteManifest, remoteManifestUrl, './Button');
  const entry = clientManifest['index.html'];

  const clientCssLinks = [...clientAssets.css]
    .map((asset) => `<link rel="stylesheet" href="/${escapeHtml(asset)}" />`)
    .join('\n');
  const clientPreloadLinks = [...clientAssets.js]
    .map((asset) => `<link rel="modulepreload" href="/${escapeHtml(clientManifest[asset].file)}" />`)
    .join('\n');
  const remoteCssLinks = [...remoteAssets.css]
    .map(
      (href) => `<link rel="stylesheet" data-mf-href="${escapeHtml(href)}" href="${escapeHtml(href)}" />`
    )
    .join('\n');
  const remotePreloadLinks = [...remoteAssets.js]
    .map((href) => `<link rel="modulepreload" crossorigin href="${escapeHtml(href)}" />`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>react-ssr-host</title>
    ${clientCssLinks}
    ${remoteCssLinks}
    ${clientPreloadLinks}
    ${remotePreloadLinks}
  </head>
  <body>
    <div id="root">${appHtml}</div>
    <script>
      window.__REMOTE_MANIFEST_URL__ = ${serializeForInlineScript(remoteManifestUrl)};
      window.__REMOTE_BUTTON_PROPS__ = ${serializeForInlineScript(buttonProps)};
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
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  try {
    const html = await renderDocument();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error instanceof Error ? error.stack || error.message : String(error));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[react-ssr-host] listening on http://127.0.0.1:${port}`);
  console.log(`[react-ssr-host] remote manifest: ${remoteManifestUrl}`);
});
