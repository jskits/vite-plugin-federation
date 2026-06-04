import { describe, expect, it } from 'vitest';
import {
  collectHtmlModuleScriptSrcs,
  injectEntryScript,
  resolveHtmlModuleScriptPath,
  rewriteEntryScripts,
  sanitizeDevEntryPath,
} from '../htmlEntryUtils';

const INIT_SRC = '/__mf__virtual/hostAutoInit.js';

describe('rewriteEntryScripts', () => {
  it('rewrites a module script tag to a proxy src', () => {
    const html = '<html><body><script type="module" src="/src/main.js"></script></body></html>';
    const result = rewriteEntryScripts(html, (src) => `/proxy?entry=${encodeURIComponent(src)}`);
    expect(result).toContain(`<script type="module" src="/proxy?entry=%2Fsrc%2Fmain.js"></script>`);
  });

  it('rewrites module scripts regardless of attribute order', () => {
    const html = '<html><body><script src="/src/main.js" type="module"></script></body></html>';
    const result = rewriteEntryScripts(html, (src) => `/proxy?entry=${encodeURIComponent(src)}`);
    expect(result).toContain(`<script src="/proxy?entry=%2Fsrc%2Fmain.js" type="module"></script>`);
  });

  it('preserves @vite/client script tag', () => {
    const html =
      '<head><script type="module" src="/@vite/client"></script></head>' +
      '<body><script type="module" src="/src/main.js"></script></body>';
    const result = rewriteEntryScripts(html, (src) => `/proxy?entry=${encodeURIComponent(src)}`);
    expect(result).toContain('src="/@vite/client"');
    expect(result).toContain(`src="/proxy?entry=%2Fsrc%2Fmain.js"`);
  });

  it('handles multiple entry scripts', () => {
    const html =
      '<body>' +
      '<script type="module" src="/src/app1.js"></script>' +
      '<script type="module" src="/src/app2.js"></script>' +
      '</body>';
    const result = rewriteEntryScripts(html, (src) => `/proxy?entry=${encodeURIComponent(src)}`);
    expect(result).toContain(`src="/proxy?entry=%2Fsrc%2Fapp1.js"`);
    expect(result).toContain(`src="/proxy?entry=%2Fsrc%2Fapp2.js"`);
  });

  it('skips inline module scripts without src attribute', () => {
    const html =
      '<head><script type="module" src="/@vite/client"></script></head>' +
      '<body><script type="module">console.log("inline")</script>' +
      '<script type="module" src="/src/main.js"></script></body>';
    const result = rewriteEntryScripts(html, (src) => `/proxy?entry=${encodeURIComponent(src)}`);
    expect(result).toContain('<script type="module">console.log("inline")</script>');
    expect(result).toContain(`src="/proxy?entry=%2Fsrc%2Fmain.js"`);
    expect(result).toContain('src="/@vite/client"');
  });

  it('returns html unchanged when no entry scripts exist', () => {
    const html = '<html><head></head><body></body></html>';
    expect(rewriteEntryScripts(html, (src) => src)).toBe(html);
  });

  it('handles single-quoted src attributes', () => {
    const html = "<body><script type='module' src='/src/main.js'></script></body>";
    const result = rewriteEntryScripts(html, (src) => `/proxy?entry=${encodeURIComponent(src)}`);
    expect(result).toContain(`src="/proxy?entry=%2Fsrc%2Fmain.js"`);
  });

  it('does not confuse data attributes with script type or src attributes', () => {
    const html =
      '<body>' +
      '<script data-type="module" src="/src/skipped.js"></script>' +
      '<script type="module" data-src="/src/ignored.js" src="/src/main.js"></script>' +
      '</body>';
    const result = rewriteEntryScripts(html, (src) => `/proxy?entry=${encodeURIComponent(src)}`);

    expect(result).toContain('data-type="module" src="/src/skipped.js"');
    expect(result).toContain('data-src="/src/ignored.js" src="/proxy?entry=%2Fsrc%2Fmain.js"');
    expect(result).not.toContain('data-src="/proxy?entry=%2Fsrc%2Fignored.js"');
  });
});

describe('injectEntryScript', () => {
  it('falls back to separate script tag when no entry scripts exist', () => {
    const html = '<html><head></head><body></body></html>';
    const result = injectEntryScript(html, INIT_SRC);
    expect(result).toContain(
      `<head><script type="module" src="/__mf__virtual/hostAutoInit.js"></script>`,
    );
  });

  it('injects into head tags with attributes', () => {
    const html = '<html><head data-app="shell"></head><body></body></html>';
    const result = injectEntryScript(html, INIT_SRC);
    expect(result).toContain(
      `<head data-app="shell"><script type="module" src="/__mf__virtual/hostAutoInit.js"></script>`,
    );
  });
});

describe('collectHtmlModuleScriptSrcs', () => {
  it('collects only module script entries and skips the Vite client', () => {
    const html =
      '<head><script type="module" src="/@vite/client"></script></head>' +
      '<body>' +
      '<script src="/legacy.js"></script>' +
      '<script type="module" src="/src/main.tsx"></script>' +
      '<script src="./src/admin.ts" type="module"></script>' +
      '</body>';

    expect(collectHtmlModuleScriptSrcs(html)).toEqual(['/src/main.tsx', './src/admin.ts']);
  });
});

describe('resolveHtmlModuleScriptPath', () => {
  it('resolves root, base-prefixed, and relative module entries', () => {
    expect(
      resolveHtmlModuleScriptPath('/src/main.tsx', '/repo/app', '/repo/app/index.html', '/'),
    ).toBe('/repo/app/src/main.tsx');
    expect(
      resolveHtmlModuleScriptPath(
        '/base/src/main.tsx',
        '/repo/app',
        '/repo/app/index.html',
        '/base/',
      ),
    ).toBe('/repo/app/src/main.tsx');
    expect(
      resolveHtmlModuleScriptPath(
        './src/admin.ts',
        '/repo/app',
        '/repo/app/nested/index.html',
        '/',
      ),
    ).toBe('/repo/app/nested/src/admin.ts');
  });
});

describe('sanitizeDevEntryPath', () => {
  it('returns path unchanged when no protocol prefix', () => {
    expect(sanitizeDevEntryPath('/src/main.js')).toBe('/src/main.js');
  });

  it('passes through paths without backslashes', () => {
    expect(sanitizeDevEntryPath('/node_modules/__mf__virtual/init.js')).toBe(
      '/node_modules/__mf__virtual/init.js',
    );
  });

  it('converts backslashes to forward slashes', () => {
    expect(sanitizeDevEntryPath('/node_modules\\__mf__virtual\\init.js')).toBe(
      '/node_modules/__mf__virtual/init.js',
    );
  });
});
