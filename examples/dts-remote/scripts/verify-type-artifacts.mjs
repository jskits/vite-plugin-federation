import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exampleDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(exampleDir, '..');
const distDir = path.join(rootDir, 'dist');

const assertFile = (relativePath) => {
  const absolutePath = path.join(distDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Expected ${relativePath} to exist in ${distDir}`);
  }
  return absolutePath;
};

const zipPath = assertFile('@mf-types.zip');
const apiTypesPath = assertFile('@mf-types.d.ts');
const manifestPath = assertFile('mf-manifest.json');
const exposedTypesPath = assertFile('@mf-types/answer.d.ts');
const compiledTypesPath = assertFile('@mf-types/compiled-types/src/answer.d.ts');

const apiTypes = fs.readFileSync(apiTypesPath, 'utf8');
if (!apiTypes.includes("RemoteKeys = 'REMOTE_ALIAS_IDENTIFIER/answer'")) {
  throw new Error('Expected @mf-types.d.ts to include the remote API key for ./answer');
}
if (!apiTypes.includes("typeof import('REMOTE_ALIAS_IDENTIFIER/answer')")) {
  throw new Error('Expected @mf-types.d.ts to expose the package type lookup for ./answer');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest?.metaData?.types?.name !== '@mf-types.zip') {
  throw new Error('Expected mf-manifest.json to advertise @mf-types.zip');
}
if (manifest?.metaData?.types?.api !== '@mf-types.d.ts') {
  throw new Error('Expected mf-manifest.json to advertise @mf-types.d.ts');
}

const zipStat = fs.statSync(zipPath);
if (zipStat.size === 0) {
  throw new Error('Expected @mf-types.zip to contain generated declarations');
}

const exposedTypes = fs.readFileSync(exposedTypesPath, 'utf8');
if (!exposedTypes.includes("export * from './compiled-types/src/answer'")) {
  throw new Error('Expected @mf-types/answer.d.ts to re-export the compiled remote declaration');
}

const compiledTypes = fs.readFileSync(compiledTypesPath, 'utf8');
if (!compiledTypes.includes('FederationAnswer') || !compiledTypes.includes('formatAnswer')) {
  throw new Error('Expected @mf-types/answer.d.ts to expose the remote API declarations');
}

console.log('DTS remote artifacts verified.');
