import { describe, expect, it, vi } from 'vitest';

import { federation, PLUGIN_NAME } from './index';

describe('federation', () => {
  it('creates a Vite plugin with a stable name', () => {
    expect(federation().name).toBe(PLUGIN_NAME);
  });

  it('logs when debug mode is enabled', () => {
    const info = vi.fn();
    const plugin = federation({ debug: true });
    const configResolved =
      typeof plugin.configResolved === 'function'
        ? plugin.configResolved
        : plugin.configResolved?.handler;

    configResolved?.call(
      {} as never,
      {
        logger: {
          info,
        },
      } as any,
    );

    expect(info).toHaveBeenCalledWith(`[${PLUGIN_NAME}] debug mode enabled`);
  });
});
