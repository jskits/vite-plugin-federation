import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    origin: 'http://localhost:4192',
    port: 4192,
  },
  preview: {
    port: 4192,
  },
  plugins: [
    svelte(),
    federation({
      name: 'svelteRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      dts: false,
      exposes: {
        './RemotePanel': './src/RemotePanel.svelte',
      },
      shared: {
        svelte: {
          singleton: true,
          requiredVersion: '^5.0.0',
        },
      },
    }),
  ],
});
