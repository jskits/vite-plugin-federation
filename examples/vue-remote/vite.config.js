import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';
import { getE2eOrigin, getE2ePort } from '../e2ePorts.mjs';

const vueDevRemotePort = getE2ePort('VUE_DEV_REMOTE');
const vuePreviewRemotePort = getE2ePort('VUE_PREVIEW_REMOTE');
const vueDevRemoteOrigin = getE2eOrigin('VUE_DEV_REMOTE');

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
      origin: vueDevRemoteOrigin,
      port: vueDevRemotePort,
    },
    preview: {
      port: vuePreviewRemotePort,
    },
    plugins: [
      vue(),
      federation({
        name: 'vueRemote',
        filename: 'remoteEntry.js',
        manifest: true,
        dts: false,
        dev: {
          remoteHmr: true,
        },
        exposes: {
          './RemoteBadge': './src/RemoteBadge.vue',
        },
        shared,
      }),
    ],
  };
});
