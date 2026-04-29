export const E2E_PORTS = {
  LIT_REMOTE: 4194,
  MULTI_REMOTE_HOST: 4196,
  ORIGINJS_HOST: 4193,
  REACT_HOST: 4173,
  REACT_REMOTE: 4174,
  SHARED_HOST_ONLY_HOST: 4192,
  SHARED_HOST_ONLY_REMOTE: 4191,
  SHARED_NEGOTIATION_LOADED_HOST: 4183,
  SHARED_NEGOTIATION_LOADED_REMOTE: 4184,
  SHARED_NEGOTIATION_VERSION_HOST: 4185,
  SHARED_NEGOTIATION_VERSION_REMOTE: 4186,
  SHARED_STRICT_FALLBACK: 4190,
  SSR_HOST: 4180,
  WEBPACK_SYSTEM_REMOTE: 4195,
  WORKSPACE_SHARED_HOST: 4201,
  WORKSPACE_SHARED_REMOTE: 4200,
};

// Playwright and command wrappers may set conflicting color environment variables, and Node warns
// when both are present. Prefer no-color e2e output without keeping both variables set.
delete process.env.NO_COLOR;
process.env.FORCE_COLOR = '0';

export function getE2ePort(name, fallback = E2E_PORTS[name]) {
  if (!fallback) {
    throw new Error(`Unknown E2E port key "${name}".`);
  }

  const rawValue = process.env[`MF_E2E_${name}_PORT`];
  if (!rawValue) {
    return fallback;
  }

  const port = Number(rawValue);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`MF_E2E_${name}_PORT must be a valid TCP port, received "${rawValue}".`);
  }

  return port;
}

export function getE2eOrigin(name) {
  return `http://localhost:${getE2ePort(name)}`;
}

export function getE2eLocalhostUrl(name, pathname = '/') {
  return new URL(pathname, `${getE2eOrigin(name)}/`).href;
}

export function getE2eLoopbackUrl(name, pathname = '/') {
  return new URL(pathname, `http://127.0.0.1:${getE2ePort(name)}/`).href;
}
