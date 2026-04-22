import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

const remoteBaseUrl = process.env.DTS_REMOTE_BASE_URL || 'http://127.0.0.1:4176';
const consumeTypesOnBuild = process.env.DTS_HOST_CONSUME_TYPES === 'true';

export default defineConfig({
  plugins: [
    federation({
      name: 'dtsHost',
      manifest: true,
      remotes: {
        dtsRemote: `${remoteBaseUrl}/mf-manifest.json`,
      },
      dts: {
        generateTypes: false,
        consumeTypes: consumeTypesOnBuild
          ? {
              abortOnError: true,
              consumeAPITypes: true,
              remoteTypeUrls: {
                dtsRemote: {
                  alias: 'dtsRemote',
                  api: `${remoteBaseUrl}/@mf-types.d.ts`,
                  zip: `${remoteBaseUrl}/@mf-types.zip`,
                },
              },
              typesOnBuild: true,
            }
          : false,
      },
      shared: {},
    }),
  ],
  build: {
    target: 'es2022',
  },
});
