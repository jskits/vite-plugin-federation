import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eOrigin, getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('REACT_REMOTE');

export default defineConfig({
  server: {
    origin: getE2eOrigin('REACT_REMOTE'),
    port,
  },
  preview: {
    port,
  },
  ssr: {
    noExternal: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  plugins: [
    react(),
    federation({
      name: 'reactRemote',
      filename: 'remoteEntry.js',
      varFilename: 'remoteEntry.var.js',
      manifest: true,
      bundleAllCSS: true,
      dts: false,
      dev: {
        remoteHmr: true,
      },
      shareStrategy: 'loaded-first',
      exposes: {
        './Button': './src/Button.jsx',
        './Card': './src/Card.jsx',
        './ManualCssButton': {
          import: './src/ManualCssButton.jsx',
          dontAppendStylesToHead: true,
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
