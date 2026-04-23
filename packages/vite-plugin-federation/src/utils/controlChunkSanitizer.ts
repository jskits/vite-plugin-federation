const FEDERATION_CONTROL_CHUNK_HINTS = [
  'hostInit',
  'virtualExposes',
  'localSharedImportMap',
  'REMOTE_ENTRY_ID',
  'SSR_REMOTE_ENTRY_ID',
] as const;

function isIdentifierChar(char: string | undefined): boolean {
  return !!char && /[A-Za-z0-9_$]/.test(char);
}

function isDynamicImportExpression(expression: string): boolean {
  return expression.trimStart().startsWith('import(');
}

function findHelperCall(code: string, alias: string, fromIndex: number): number {
  const marker = `${alias}(()=>`;
  let start = code.indexOf(marker, fromIndex);

  while (start !== -1 && isIdentifierChar(code[start - 1])) {
    start = code.indexOf(marker, start + marker.length);
  }

  return start;
}

function inlinePreloadHelperCalls(
  code: string,
  aliases: string[],
): { code: string; inlinedAliases: Set<string> } {
  let nextCode = code;
  const inlinedAliases = new Set<string>();

  for (const alias of aliases) {
    const marker = `${alias}(()=>`;
    let start = findHelperCall(nextCode, alias, 0);

    while (start !== -1) {
      const exprStart = start + marker.length;
      let depth = 0;
      let cursor = exprStart;
      let argsStart = -1;

      while (cursor < nextCode.length) {
        const char = nextCode[cursor];
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ',' && depth === 0) {
          argsStart = cursor + 1;
          break;
        }
        cursor++;
      }

      if (argsStart === -1) {
        start = findHelperCall(nextCode, alias, start + marker.length);
        continue;
      }

      const expression = nextCode.slice(exprStart, cursor);
      if (!isDynamicImportExpression(expression)) {
        start = findHelperCall(nextCode, alias, start + marker.length);
        continue;
      }

      depth = 1;
      cursor = argsStart;
      let helperCallEnd = -1;

      while (cursor < nextCode.length) {
        const char = nextCode[cursor];
        if (char === '(') depth++;
        else if (char === ')') {
          depth--;
          if (depth === 0) {
            helperCallEnd = cursor + 1;
            break;
          }
        }
        cursor++;
      }

      if (helperCallEnd === -1) {
        start = findHelperCall(nextCode, alias, start + marker.length);
        continue;
      }

      nextCode = nextCode.slice(0, start) + expression + nextCode.slice(helperCallEnd);
      inlinedAliases.add(alias);
      start = findHelperCall(nextCode, alias, start + expression.length);
    }
  }

  return { code: nextCode, inlinedAliases };
}

function inlineEmptyPreloadHelperCalls(code: string, aliases: string[]): string {
  let nextCode = code;

  for (const alias of aliases) {
    const marker = `${alias}(()=>`;
    let start = findHelperCall(nextCode, alias, 0);

    while (start !== -1) {
      const exprStart = start + marker.length;
      let depth = 0;
      let cursor = exprStart;
      let argsStart = -1;

      while (cursor < nextCode.length) {
        const char = nextCode[cursor];
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (char === ',' && depth === 0) {
          argsStart = cursor + 1;
          break;
        }
        cursor++;
      }

      if (argsStart === -1) {
        start = findHelperCall(nextCode, alias, start + marker.length);
        continue;
      }

      let argsCursor = argsStart;
      while (/\s/.test(nextCode[argsCursor] || '')) argsCursor++;

      if (!nextCode.startsWith('[]', argsCursor)) {
        start = findHelperCall(nextCode, alias, start + marker.length);
        continue;
      }

      const expression = nextCode.slice(exprStart, cursor);
      if (!isDynamicImportExpression(expression)) {
        start = findHelperCall(nextCode, alias, start + marker.length);
        continue;
      }

      depth = 1;
      cursor = argsCursor + 2;
      let helperCallEnd = -1;

      while (cursor < nextCode.length) {
        const char = nextCode[cursor];
        if (char === '(') depth++;
        else if (char === ')') {
          depth--;
          if (depth === 0) {
            helperCallEnd = cursor + 1;
            break;
          }
        }
        cursor++;
      }

      if (helperCallEnd === -1) {
        start = findHelperCall(nextCode, alias, start + marker.length);
        continue;
      }

      nextCode = nextCode.slice(0, start) + expression + nextCode.slice(helperCallEnd);
      start = findHelperCall(nextCode, alias, start + expression.length);
    }
  }

  return nextCode;
}

function getNamedImportAliases(specifiers: string): string[] {
  return getNamedImportBindings(specifiers).map((binding) => binding.local);
}

function getNamedImportBindings(specifiers: string[]): Array<{ imported: string; local: string }>;
function getNamedImportBindings(specifiers: string): Array<{ imported: string; local: string }>;
function getNamedImportBindings(
  specifiers: string | string[],
): Array<{ imported: string; local: string }> {
  const specifierList = Array.isArray(specifiers) ? specifiers : specifiers.split(',');

  return specifierList
    .map((specifier) => specifier.trim())
    .map((specifier) => {
      const aliasMatch = specifier.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) return { imported: aliasMatch[1], local: aliasMatch[2] };
      const directMatch = specifier.match(/^([A-Za-z_$][\w$]*)$/);
      if (directMatch) return { imported: directMatch[1], local: directMatch[1] };
      return undefined;
    })
    .filter((binding): binding is { imported: string; local: string } => !!binding);
}

function hasIdentifierUsage(code: string, local: string): boolean {
  const helperCallRegex = new RegExp(`\\b${local}\\s*\\(`);
  const identifierRegex = new RegExp(`\\b${local}\\b`);
  return helperCallRegex.test(code) || identifierRegex.test(code);
}

export function stripLoadSharePreloadHelperCalls(code: string): string {
  const loadShareHelperImportRegex =
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*(["'][^"']*__loadShare__[^"']*["'])\s*;?/g;
  const loadShareHelperAliases = [...code.matchAll(loadShareHelperImportRegex)].flatMap((match) =>
    getNamedImportAliases(match[1]),
  );
  const inlined = inlinePreloadHelperCalls(code, loadShareHelperAliases);
  let nextCode = inlined.code;

  nextCode = nextCode.replace(loadShareHelperImportRegex, (statement, specifiers, source) => {
    const remainingBindings = getNamedImportBindings(specifiers).filter((binding) => {
      if (inlined.inlinedAliases.has(binding.local)) return false;
      return hasIdentifierUsage(nextCode.replace(statement, ''), binding.local);
    });

    if (remainingBindings.length === 0) {
      return '';
    }

    const keptSpecifiers = remainingBindings
      .map((binding) =>
        binding.imported === binding.local
          ? binding.imported
          : `${binding.imported} as ${binding.local}`,
      )
      .join(',');

    return `import{${keptSpecifiers}}from${source};`;
  });

  return nextCode;
}

export function stripEmptyPreloadCalls(code: string): string {
  const legacyHelperImportRegex = /import\s*\{\s*_\s*as\s*(\w+)\s*\}\s*from\s*["'][^"']+["']\s*;?/g;
  const preloadHelperImportRegex =
    /import\s*\{\s*([^}]+)\s*\}\s*from\s*["'][^"']*preload-helper[^"']*["']\s*;?/g;
  const helperAliases = [
    ...[...code.matchAll(legacyHelperImportRegex)].map((match) => match[1]),
    ...[...code.matchAll(preloadHelperImportRegex)].flatMap((match) =>
      getNamedImportAliases(match[1]),
    ),
    '__vitePreload',
  ];
  let nextCode = inlineEmptyPreloadHelperCalls(code, helperAliases);

  nextCode = nextCode.replace(/import\s*["'][^"']*__loadShare__[^"']*["']\s*;?/g, '');
  nextCode = stripLoadSharePreloadHelperCalls(nextCode);

  nextCode = nextCode.replace(legacyHelperImportRegex, (statement, local) => {
    const helperCallRegex = new RegExp(`\\b${local}\\s*\\(`);
    return helperCallRegex.test(nextCode.replace(statement, '')) ? statement : '';
  });
  nextCode = nextCode.replace(preloadHelperImportRegex, (statement, specifiers) => {
    const aliases = getNamedImportAliases(specifiers);
    const hasRemainingUsage = aliases.some((local) => {
      const helperCallRegex = new RegExp(`\\b${local}\\s*\\(`);
      return helperCallRegex.test(nextCode.replace(statement, ''));
    });
    return hasRemainingUsage ? statement : '';
  });

  return nextCode;
}

export function isFederationControlChunk(fileName: string, filename: string): boolean {
  return (
    fileName.includes(filename) ||
    FEDERATION_CONTROL_CHUNK_HINTS.some((hint) => fileName.includes(hint))
  );
}

export function sanitizeFederationControlChunk(
  code: string,
  fileName: string,
  filename: string,
): string {
  let nextCode = stripEmptyPreloadCalls(code);

  if (fileName.includes('localSharedImportMap')) {
    const remoteEntryImportRegex = new RegExp(
      `import\\s*["'][^"']*${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\s*;?`,
      'g',
    );
    nextCode = nextCode.replace(remoteEntryImportRegex, '');
  }

  return nextCode;
}
