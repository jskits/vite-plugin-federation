import type { Plugin } from 'vite';

export const PLUGIN_NAME = 'vite-plugin-federation';

export interface FederationPluginOptions {
  debug?: boolean;
}

export function federation(options: FederationPluginOptions = {}): Plugin {
  return {
    configResolved(config) {
      if (options.debug) {
        config.logger.info(`[${PLUGIN_NAME}] debug mode enabled`);
      }
    },
    name: PLUGIN_NAME,
  };
}
