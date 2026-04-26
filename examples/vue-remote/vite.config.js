import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    origin: 'http://localhost:4190',
    port: 4190,
  },
  preview: {
    port: 4190,
  },
  plugins: [
    vue(),
    federation({
      name: 'vueRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      dts: false,
      exposes: {
        './RemoteBadge': './src/RemoteBadge.vue',
      },
      shared: {
        vue: {
          singleton: true,
          requiredVersion: '^3.0.0',
        },
      },
    }),
  ],
});
