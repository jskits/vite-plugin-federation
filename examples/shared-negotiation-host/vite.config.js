import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eLocalhostUrl, getE2ePort } from '../e2ePorts.mjs';

const scenario =
  process.env.MF_SHARE_SCENARIO === 'version-first' ? 'version-first' : 'loaded-first';
const outDir = process.env.MF_OUT_DIR || `dist-${scenario}`;
const remotePortKey =
  scenario === 'version-first'
    ? 'SHARED_NEGOTIATION_VERSION_REMOTE'
    : 'SHARED_NEGOTIATION_LOADED_REMOTE';
const hostPort = getE2ePort(
  scenario === 'version-first'
    ? 'SHARED_NEGOTIATION_VERSION_HOST'
    : 'SHARED_NEGOTIATION_LOADED_HOST',
);
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const sharedValuePath = path.join(packageDir, 'src/shared-value.js');

export default defineConfig({
  build: {
    outDir,
  },
  preview: {
    port: hostPort,
  },
  server: {
    port: hostPort,
  },
  define: {
    __MF_REMOTE_MANIFEST_URL__: JSON.stringify(
      getE2eLocalhostUrl(remotePortKey, '/mf-manifest.json'),
    ),
    __MF_SHARE_SCENARIO__: JSON.stringify(scenario),
  },
  plugins: [
    federation({
      name: 'sharedHost',
      dts: false,
      shareStrategy: scenario,
      shared: {
        '@mf-e2e/shared-value': {
          import: sharedValuePath,
          singleton: true,
          requiredVersion: '*',
          version: '1.0.0',
        },
      },
    }),
  ],
});
