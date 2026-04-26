import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  preview: {
    port: 4200,
  },
  server: {
    port: 4200,
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
