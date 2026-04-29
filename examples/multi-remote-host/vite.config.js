import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eLocalhostUrl, getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('MULTI_REMOTE_HOST');

export default defineConfig({
  server: {
    port,
  },
  preview: {
    port,
  },
  define: {
    __MF_LIT_REMOTE_MANIFEST_URL__: JSON.stringify(
      getE2eLocalhostUrl('LIT_REMOTE', '/mf-manifest.json'),
    ),
    __MF_REACT_REMOTE_MANIFEST_URL__: JSON.stringify(
      getE2eLocalhostUrl('REACT_REMOTE', '/mf-manifest.json'),
    ),
  },
  plugins: [
    react(),
    federation({
      name: 'multiRemoteHost',
      dts: false,
      shared: {
        lit: {
          singleton: true,
          requiredVersion: '^3.0.0',
        },
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
