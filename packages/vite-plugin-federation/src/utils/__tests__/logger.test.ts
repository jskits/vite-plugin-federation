import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearModuleFederationDebugState,
  createModuleFederationError,
  formatModuleFederationMessage,
  getModuleFederationDebugState,
  mfWarnWithCode,
} from '../logger';

describe('logger', () => {
  beforeEach(() => {
    clearModuleFederationDebugState();
    vi.restoreAllMocks();
  });

  it('formats messages with error codes', () => {
    expect(formatModuleFederationMessage('invalid config', 'MFV-001')).toBe(
      '[Module Federation] MFV-001 invalid config',
    );
  });

  it('stores created errors in debug state', () => {
    const error = createModuleFederationError('MFV-001', 'invalid config');
    const debugState = getModuleFederationDebugState();

    expect(error.message).toContain('MFV-001 invalid config');
    expect(debugState.lastError?.code).toBe('MFV-001');
    expect(debugState.recentEvents.at(-1)?.message).toBe('invalid config');
  });

  it('records warnings with codes', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mfWarnWithCode('MFV-007', 'Use loadRemote()');

    const debugState = getModuleFederationDebugState();

    expect(warnSpy).toHaveBeenCalledWith('[Module Federation] MFV-007 Use loadRemote()');
    expect(debugState.recentEvents.at(-1)).toMatchObject({
      code: 'MFV-007',
      level: 'warn',
      message: 'Use loadRemote()',
    });
  });
});
