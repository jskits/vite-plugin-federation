import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const args = process.argv.slice(2);
const packageDir = getPackageDir();
const packJson = await readInput();
const packageJson = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
const packInfo = normalizePackInfo(packJson);
const packedFiles = new Set((packInfo.files || []).map((entry) => entry.path));
const requiredFiles = collectRequiredFiles(packageJson);

const missingFiles = [...requiredFiles].filter((file) => !packedFiles.has(file));
if (missingFiles.length > 0) {
  throw new Error(`Packed tarball is missing required files: ${missingFiles.join(', ')}`);
}

const distFileCount = [...packedFiles].filter((file) => file.startsWith('dist/')).length;
if (distFileCount === 0) {
  throw new Error('Packed tarball does not include any dist files.');
}

console.log(
  `Packed tarball includes ${packInfo.files.length} files, including ${distFileCount} dist files.`,
);

function getPackageDir() {
  const packageDirArg = args.find((arg) => arg.startsWith('--package-dir='));
  if (packageDirArg) {
    return path.resolve(repoRoot, packageDirArg.slice('--package-dir='.length));
  }
  return path.join(repoRoot, 'packages', 'vite-plugin-federation');
}

async function readInput() {
  const inputPath = args.find((arg) => !arg.startsWith('--'));
  const input = inputPath
    ? await readFile(inputPath, 'utf8')
    : await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
          data += chunk;
        });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
      });

  if (!input.trim()) {
    throw new Error('No npm pack JSON was provided.');
  }

  return JSON.parse(input);
}

function normalizePackInfo(packJson) {
  const packInfo = Array.isArray(packJson) ? packJson[0] : packJson;
  if (!packInfo || !Array.isArray(packInfo.files)) {
    throw new Error('npm pack JSON must include a files array.');
  }
  return packInfo;
}

function collectRequiredFiles(packageJson) {
  const requiredFiles = new Set([
    'package.json',
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/runtime/index.js',
    'dist/runtime/index.cjs',
    'dist/runtime/index.d.ts',
  ]);

  collectPackageEntryFiles(requiredFiles, packageJson.main);
  collectPackageEntryFiles(requiredFiles, packageJson.module);
  collectPackageEntryFiles(requiredFiles, packageJson.types);
  collectPackageEntryFiles(requiredFiles, packageJson.exports);

  return requiredFiles;
}

function collectPackageEntryFiles(requiredFiles, value) {
  if (typeof value === 'string') {
    const normalizedFile = normalizePackageFile(value);
    if (normalizedFile) requiredFiles.add(normalizedFile);
    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const nestedValue of Object.values(value)) {
    collectPackageEntryFiles(requiredFiles, nestedValue);
  }
}

function normalizePackageFile(file) {
  if (/^[a-z]+:/i.test(file)) return undefined;
  return file.replace(/^\.\//, '').replaceAll('\\', '/');
}
