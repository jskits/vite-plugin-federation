import { defineConfig } from 'vite';
import { getE2eLocalhostUrl, getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('SHARED_HOST_ONLY_HOST');

export default defineConfig({
  define: {
    __MF_HOST_ONLY_REMOTE_MANIFEST_URL__: JSON.stringify(
      getE2eLocalhostUrl('SHARED_HOST_ONLY_REMOTE', '/mf-manifest.json'),
    ),
  },
  preview: {
    port,
  },
  server: {
    port,
  },
});
