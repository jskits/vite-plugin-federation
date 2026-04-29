import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eOrigin, getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('LIT_REMOTE');

export default defineConfig({
  server: {
    origin: getE2eOrigin('LIT_REMOTE'),
    port,
  },
  preview: {
    port,
  },
  plugins: [
    federation({
      name: 'litRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      dts: false,
      exposes: {
        './RemoteLitCard': './src/remote-lit-card.js',
      },
      shared: {
        lit: {
          singleton: true,
          requiredVersion: '^3.0.0',
        },
      },
    }),
  ],
});
