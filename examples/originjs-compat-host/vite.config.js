import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    port: 4193,
  },
  preview: {
    port: 4193,
  },
  plugins: [
    react(),
    federation({
      name: 'originCompatHost',
      dts: false,
      compat: {
        originjs: true,
        virtualFederationShim: true,
      },
      remotes: {
        reactRemote: {
          name: 'reactRemote',
          entry: 'http://localhost:4174/remoteEntry.js',
          type: 'module',
          format: 'esm',
          from: 'vite',
          shareScope: 'default',
        },
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: '^19.2.4',
        },
        'react/': {
          singleton: true,
          requiredVersion: '^19.2.4',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^19.2.4',
        },
        'react-dom/': {
          singleton: true,
          requiredVersion: '^19.2.4',
        },
      },
    }),
  ],
});
