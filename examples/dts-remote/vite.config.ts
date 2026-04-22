import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

const answerExpose =
  process.env.DTS_REMOTE_INVALID_TYPES === 'true'
    ? './fixtures/invalid-types/answer.ts'
    : './src/answer.ts';

export default defineConfig({
  plugins: [
    federation({
      name: 'dtsRemote',
      filename: 'remoteEntry.js',
      manifest: true,
      exposes: {
        './answer': answerExpose,
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
