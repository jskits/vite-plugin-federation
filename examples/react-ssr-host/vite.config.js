import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  ssr: {
    external: ['vite-plugin-federation/runtime'],
  },
  build: {
    manifest: !isSsrBuild,
    sourcemap: true,
    target: 'esnext',
  },
}));
