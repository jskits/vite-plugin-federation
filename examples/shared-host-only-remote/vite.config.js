import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

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
    port: 4191,
  },
  server: {
    port: 4191,
  },
});
