const MODULE_FEDERATION_LOG_PREFIX = '[Module Federation]';
const MODULE_FEDERATION_DEBUG_SYMBOL = Symbol.for('vite-plugin-federation.debug');

export type ModuleFederationErrorCode =
  | 'MFV-001'
  | 'MFV-002'
  | 'MFV-003'
  | 'MFV-004'
  | 'MFV-005'
  | 'MFV-006'
  | 'MFV-007';

export interface ModuleFederationDebugEvent {
  code?: ModuleFederationErrorCode;
  details: unknown[];
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

interface ModuleFederationDebugState {
  lastError: ModuleFederationDebugEvent | null;
  recentEvents: ModuleFederationDebugEvent[];
}

function getDebugState(): ModuleFederationDebugState {
  const state = globalThis as typeof globalThis & {
    [MODULE_FEDERATION_DEBUG_SYMBOL]?: ModuleFederationDebugState;
  };

  state[MODULE_FEDERATION_DEBUG_SYMBOL] ||= {
    lastError: null,
    recentEvents: [],
  };

  return state[MODULE_FEDERATION_DEBUG_SYMBOL];
}

function recordDebugEvent(
  level: ModuleFederationDebugEvent['level'],
  message: string,
  details: unknown[] = [],
  code?: ModuleFederationErrorCode,
) {
  const state = getDebugState();
  const event: ModuleFederationDebugEvent = {
    code,
    details,
    level,
    message,
    timestamp: new Date().toISOString(),
  };

  state.recentEvents.push(event);
  if (state.recentEvents.length > 50) {
    state.recentEvents.shift();
  }
  if (level === 'error') {
    state.lastError = event;
  }
}

export function formatModuleFederationMessage(message: string, code?: ModuleFederationErrorCode) {
  return `${MODULE_FEDERATION_LOG_PREFIX}${code ? ` ${code}` : ''} ${message}`;
}

export function createModuleFederationError(
  codeOrMessage: ModuleFederationErrorCode | string,
  message?: string,
) {
  const code = message ? (codeOrMessage as ModuleFederationErrorCode) : undefined;
  const errorMessage = message ?? codeOrMessage;
  const error = new Error(formatModuleFederationMessage(errorMessage, code));

  if (code) {
    (error as Error & { code?: ModuleFederationErrorCode }).code = code;
  }

  recordDebugEvent('error', errorMessage, [], code);
  return error;
}

function toConsoleArgs(
  level: ModuleFederationDebugEvent['level'],
  message?: unknown,
  rest: unknown[] = [],
  code?: ModuleFederationErrorCode,
) {
  if (typeof message === 'string') {
    recordDebugEvent(level, message, rest, code);
    return [formatModuleFederationMessage(message, code), ...rest];
  }

  if (message === undefined) {
    recordDebugEvent(level, MODULE_FEDERATION_LOG_PREFIX, rest, code);
    return [MODULE_FEDERATION_LOG_PREFIX, ...rest];
  }

  recordDebugEvent(level, String(message), rest, code);
  return [MODULE_FEDERATION_LOG_PREFIX, message, ...rest];
}

export const moduleFederationConsole = {
  log(message?: unknown, ...rest: unknown[]) {
    console.log(...toConsoleArgs('log', message, rest));
  },
  warn(message?: unknown, ...rest: unknown[]) {
    console.warn(...toConsoleArgs('warn', message, rest));
  },
  error(message?: unknown, ...rest: unknown[]) {
    console.error(...toConsoleArgs('error', message, rest));
  },
};

export const mfLog = moduleFederationConsole.log;
export const mfWarn = moduleFederationConsole.warn;
export const mfError = moduleFederationConsole.error;

export function mfWarnWithCode(
  code: ModuleFederationErrorCode,
  message?: unknown,
  ...rest: unknown[]
) {
  console.warn(...toConsoleArgs('warn', message, rest, code));
}

export function mfErrorWithCode(
  code: ModuleFederationErrorCode,
  message?: unknown,
  ...rest: unknown[]
) {
  console.error(...toConsoleArgs('error', message, rest, code));
}

export function getModuleFederationDebugState() {
  const state = getDebugState();
  return {
    lastError: state.lastError ? { ...state.lastError } : null,
    recentEvents: state.recentEvents.map((event) => ({ ...event })),
  };
}

export function clearModuleFederationDebugState() {
  const state = getDebugState();
  state.lastError = null;
  state.recentEvents = [];
}
