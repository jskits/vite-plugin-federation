import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('WORKSPACE_SHARED_REMOTE');

export default defineConfig({
  preview: {
    port,
  },
  server: {
    port,
  },
  plugins: [
    federation({
      name: 'workspaceSharedRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      dts: false,
      exposes: {
        './Widget': './src/Widget.js',
      },
      shared: {
        '@mf-examples/workspace-shared/report': {
          singleton: true,
          requiredVersion: '*',
          allowNodeModulesSuffixMatch: true,
        },
      },
    }),
  ],
});
