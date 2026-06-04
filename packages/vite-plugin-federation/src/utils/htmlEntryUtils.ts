import path from 'pathe';

const SCRIPT_TAG_RE = /<script\b([^>]*)>/gi;
const MODULE_TYPE_ATTR_RE = /(?:^|\s)type\s*=\s*["']module["']/i;
const SRC_ATTR_RE = /(^|\s)(src)\s*=\s*(["'])([^"']+)\3/i;
const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export function sanitizeDevEntryPath(devEntryPath: string): string {
  // devEntryPath is already root-relative at this point (built in pluginAddEntry),
  // just normalize any remaining backslashes for use in HTML/URLs.
  return devEntryPath.replace(/\\\\?/g, '/');
}

export function collectHtmlModuleScriptSrcs(html: string): string[] {
  const entries: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = SCRIPT_TAG_RE.exec(html)) !== null) {
    const attrs = match[1];
    if (!MODULE_TYPE_ATTR_RE.test(attrs)) continue;
    const srcMatch = attrs.match(SRC_ATTR_RE);
    if (!srcMatch) continue;
    const src = srcMatch[4];
    if (src.includes('@vite/client')) continue;
    entries.push(src);
  }

  return entries;
}

export function resolveHtmlModuleScriptPath(
  src: string,
  root: string,
  htmlFilePath: string,
  base = '/',
): string | undefined {
  const cleanSrc = src.split(/[?#]/)[0]?.replace(/\\\\?/g, '/');
  if (!cleanSrc || ABSOLUTE_URL_RE.test(cleanSrc)) return;

  const normalizedBase = base.replace(/\/$/, '');
  const baseStrippedSrc =
    normalizedBase && cleanSrc.startsWith(`${normalizedBase}/`)
      ? cleanSrc.slice(normalizedBase.length)
      : cleanSrc;

  if (baseStrippedSrc.startsWith('/')) {
    return path.resolve(root, `.${baseStrippedSrc}`);
  }

  return path.resolve(path.dirname(htmlFilePath), baseStrippedSrc);
}

/**
 * Rewrites entry module script tags to point at an external wrapper module.
 * The wrapper can then sequence federation init before the app entry without
 * relying on CSP-breaking inline `<script type="module">`.
 */
export function rewriteEntryScripts(
  html: string,
  createProxySrc: (entrySrc: string) => string,
): string {
  return html.replace(SCRIPT_TAG_RE, (match, attrs) => {
    if (!MODULE_TYPE_ATTR_RE.test(attrs)) return match;
    const srcMatch = attrs.match(SRC_ATTR_RE);
    if (!srcMatch) return match;
    const originalSrc = srcMatch[4];
    if (originalSrc.includes('@vite/client')) return match;
    const proxySrc = createProxySrc(originalSrc);
    return match.replace(srcMatch[0], `${srcMatch[1]}${srcMatch[2]}=${JSON.stringify(proxySrc)}`);
  });
}

export function injectScriptIntoHead(html: string, scriptContent: string): string {
  return html.replace(/<head\b[^>]*>/i, (headTag) => `${headTag}${scriptContent}`);
}

export function injectEntryScript(html: string, initSrc: string): string {
  const src = sanitizeDevEntryPath(initSrc);
  return injectScriptIntoHead(html, `<script type="module" src=${JSON.stringify(src)}></script>`);
}
