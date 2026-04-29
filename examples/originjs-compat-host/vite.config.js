import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eLocalhostUrl, getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('ORIGINJS_HOST');
const reactRemoteOrigin = new URL(getE2eLocalhostUrl('REACT_REMOTE')).origin;
const webpackSystemRemoteOrigin = new URL(getE2eLocalhostUrl('WEBPACK_SYSTEM_REMOTE')).origin;

export default defineConfig({
  server: {
    port,
  },
  preview: {
    port,
  },
  define: {
    __MF_ORIGINJS_REACT_REMOTE_ORIGIN__: JSON.stringify(reactRemoteOrigin),
    __MF_ORIGINJS_WEBPACK_SYSTEM_REMOTE_ORIGIN__: JSON.stringify(webpackSystemRemoteOrigin),
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
          entry: `${reactRemoteOrigin}/remoteEntry.js`,
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
