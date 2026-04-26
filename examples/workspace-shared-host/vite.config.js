import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  preview: {
    port: 4201,
  },
  server: {
    port: 4201,
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
