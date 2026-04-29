import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eLocalhostUrl, getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('REACT_HOST');
const reactRemoteManifestUrl = getE2eLocalhostUrl('REACT_REMOTE', '/mf-manifest.json');

export default defineConfig({
  server: {
    port,
  },
  preview: {
    port,
  },
  plugins: [
    react(),
    federation({
      name: 'reactHost',
      dts: false,
      dev: {
        remoteHmr: true,
      },
      shareStrategy: 'loaded-first',
      remotes: {
        reactRemote: reactRemoteManifestUrl,
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
