import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2ePort } from '../e2ePorts.mjs';

const scenario =
  process.env.MF_SHARE_SCENARIO === 'version-first' ? 'version-first' : 'loaded-first';
const outDir = process.env.MF_OUT_DIR || `dist-${scenario}`;
const port = getE2ePort(
  scenario === 'version-first'
    ? 'SHARED_NEGOTIATION_VERSION_REMOTE'
    : 'SHARED_NEGOTIATION_LOADED_REMOTE',
);
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const sharedValuePath = path.join(packageDir, 'src/shared-value.js');

export default defineConfig({
  build: {
    outDir,
  },
  preview: {
    port,
  },
  server: {
    port,
  },
  define: {
    __MF_SHARE_SCENARIO__: JSON.stringify(scenario),
  },
  plugins: [
    federation({
      name: 'sharedRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      dts: false,
      shareStrategy: scenario,
      exposes: {
        './Widget': './src/Widget.js',
      },
      shared: {
        '@mf-e2e/shared-value': {
          import: sharedValuePath,
          singleton: true,
          requiredVersion: '*',
          version: '2.0.0',
        },
      },
    }),
  ],
});
