import { defineConfig } from 'vite';
import { getE2ePort } from '../e2ePorts.mjs';

const port = getE2ePort('SHARED_STRICT_FALLBACK');

export default defineConfig({
  preview: {
    port,
  },
  server: {
    port,
  },
});
