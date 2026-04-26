import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    port: 4195,
  },
  preview: {
    port: 4195,
  },
  plugins: [
    federation({
      name: 'litHost',
      dts: false,
      remotes: {
        litRemote: 'http://localhost:4194/mf-manifest.json',
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
