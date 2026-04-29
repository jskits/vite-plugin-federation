import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('SHARED_HOST_ONLY_REMOTE');

export default defineConfig({
  plugins: [
    federation({
      name: 'hostOnlyRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      dts: false,
      exposes: {
        './Widget': './src/Widget.js',
      },
      shared: {
        'host-only-dep': {
          import: false,
          requiredVersion: '^1.2.3',
          singleton: true,
          strictVersion: true,
        },
      },
    }),
  ],
  preview: {
    port,
  },
  server: {
    port,
  },
});
