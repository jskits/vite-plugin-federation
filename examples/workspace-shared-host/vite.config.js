import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eLocalhostUrl, getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('WORKSPACE_SHARED_HOST');

export default defineConfig({
  define: {
    __MF_WORKSPACE_REMOTE_MANIFEST_URL__: JSON.stringify(
      getE2eLocalhostUrl('WORKSPACE_SHARED_REMOTE', '/mf-manifest.json'),
    ),
  },
  preview: {
    port,
  },
  server: {
    port,
  },
  plugins: [
    federation({
      name: 'workspaceSharedHost',
      dts: false,
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
