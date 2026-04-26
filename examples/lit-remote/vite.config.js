import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    origin: 'http://localhost:4194',
    port: 4194,
  },
  preview: {
    port: 4194,
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
