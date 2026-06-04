import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eOrigin, getE2ePort } from '../e2ePorts.mjs';

const vueDevHostPort = getE2ePort('VUE_DEV_HOST');
const vuePreviewHostPort = getE2ePort('VUE_PREVIEW_HOST');
const vueRemoteOrigin = process.env.MF_E2E_VUE_REMOTE_ORIGIN || getE2eOrigin('VUE_DEV_REMOTE');

export default defineConfig(({ command }) => {
  const shared = {
    vue: {
      singleton: true,
      requiredVersion: '^3.0.0',
    },
  };

  if (command === 'build') {
    shared['@mf-examples/vue-shared-core'] = {
      singleton: true,
    };
  }

  return {
    server: {
      port: vueDevHostPort,
    },
    preview: {
      port: vuePreviewHostPort,
    },
    plugins: [
      vue(),
      federation({
        name: 'vueHost',
        filename: 'remoteEntry.js',
        dts: false,
        remotes: {
          vueRemote: `${vueRemoteOrigin}/mf-manifest.json`,
        },
        shared,
      }),
    ],
  };
});
