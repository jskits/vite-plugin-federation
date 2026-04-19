import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    port: 4173,
  },
  preview: {
    port: 4173,
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
        reactRemote: 'http://localhost:4174/mf-manifest.json',
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
