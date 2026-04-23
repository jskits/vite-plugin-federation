import { fileURLToPath } from 'node:url';
import path from 'pathe';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

const scenario =
  process.env.MF_SHARE_SCENARIO === 'version-first' ? 'version-first' : 'loaded-first';
const outDir = process.env.MF_OUT_DIR || `dist-${scenario}`;
const remotePort = scenario === 'version-first' ? 4186 : 4184;
const hostPort = scenario === 'version-first' ? 4185 : 4183;
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
    __MF_REMOTE_MANIFEST_URL__: JSON.stringify(`http://localhost:${remotePort}/mf-manifest.json`),
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
