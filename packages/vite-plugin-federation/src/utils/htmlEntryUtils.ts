export function sanitizeDevEntryPath(devEntryPath: string): string {
  // devEntryPath is already root-relative at this point (built in pluginAddEntry),
  // just normalize any remaining backslashes for use in HTML/URLs.
  return devEntryPath.replace(/\\\\?/g, '/');
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
  const scriptTagRegex = /<script\b([^>]*)>/gi;
  const moduleTypeAttrRegex = /(?:^|\s)type\s*=\s*["']module["']/i;
  const srcAttrRegex = /(^|\s)(src)\s*=\s*(["'])([^"']+)\3/i;

  return html.replace(scriptTagRegex, (match, attrs) => {
    if (!moduleTypeAttrRegex.test(attrs)) return match;
    const srcMatch = attrs.match(srcAttrRegex);
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
