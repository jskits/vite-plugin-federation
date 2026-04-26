import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    port: 4191,
  },
  preview: {
    port: 4191,
  },
  plugins: [
    vue(),
    federation({
      name: 'vueHost',
      dts: false,
      remotes: {
        vueRemote: 'http://localhost:4190/mf-manifest.json',
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
