const devRemoteVersionState = new Map<string, Map<string, number>>();

function getScopeState(scope: string) {
  let scopeState = devRemoteVersionState.get(scope);
  if (!scopeState) {
    scopeState = new Map<string, number>();
    devRemoteVersionState.set(scope, scopeState);
  }
  return scopeState;
}

export function setDevRemoteVersion(
  scope: string | undefined,
  remoteRequestId: string,
  version: number,
) {
  if (!scope || !remoteRequestId || !Number.isFinite(version)) return;
  getScopeState(scope).set(remoteRequestId, version);
}

export function getDevRemoteVersion(scope: string | undefined, remoteRequestId: string) {
  if (!scope || !remoteRequestId) return;
  return devRemoteVersionState.get(scope)?.get(remoteRequestId);
}

export function clearDevRemoteVersions(scope?: string) {
  if (!scope) {
    devRemoteVersionState.clear();
    return;
  }
  devRemoteVersionState.delete(scope);
}
