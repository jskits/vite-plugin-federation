import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  plugins: [
    federation({
      name: 'dtsRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      exposes: {
        './answer': './src/answer.ts',
      },
      dts: {
        generateTypes: {
          abortOnError: true,
          generateAPITypes: true,
          typesFolder: '@mf-types',
        },
        consumeTypes: false,
      },
      shared: {},
    }),
  ],
  build: {
    target: 'es2022',
  },
});
