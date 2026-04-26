import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    port: 4196,
  },
  preview: {
    port: 4196,
  },
  plugins: [
    react(),
    federation({
      name: 'multiRemoteHost',
      dts: false,
      shared: {
        lit: {
          singleton: true,
          requiredVersion: '^3.0.0',
        },
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
