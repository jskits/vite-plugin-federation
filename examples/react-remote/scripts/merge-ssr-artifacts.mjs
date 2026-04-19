import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const clientDir = path.join(projectDir, 'dist');
const ssrBuildDir = path.join(projectDir, 'dist-ssr');
const mergedSsrDir = path.join(clientDir, 'ssr');

async function patchJsonFile(filePath, patch) {
  const content = await readFile(filePath, 'utf8');
  const data = JSON.parse(content);
  patch(data);
  await writeFile(filePath, `${JSON.stringify(data)}\n`);
}

function patchManifestSsrPath(data) {
  if (data?.metaData?.ssrRemoteEntry) {
    data.metaData.ssrRemoteEntry = {
      ...data.metaData.ssrRemoteEntry,
      path: 'ssr',
    };
  }
}

await rm(mergedSsrDir, { recursive: true, force: true });
await mkdir(clientDir, { recursive: true });
await cp(ssrBuildDir, mergedSsrDir, { recursive: true });

await patchJsonFile(path.join(clientDir, 'mf-manifest.json'), patchManifestSsrPath);
await patchJsonFile(path.join(clientDir, 'mf-stats.json'), patchManifestSsrPath);
await patchJsonFile(path.join(clientDir, 'mf-debug.json'), (data) => {
  if (data?.snapshot) {
    patchManifestSsrPath(data.snapshot);
  }
});
