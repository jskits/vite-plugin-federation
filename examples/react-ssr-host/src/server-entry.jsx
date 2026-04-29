import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  fetchFederationManifest,
  getFederationDebugInfo,
  loadRemoteFromManifest,
} from 'vite-plugin-federation/runtime';
import { AppShell } from './AppShell.jsx';
import {
  DEFAULT_REMOTE_MANIFEST_URL,
  ensureServerFederation,
  getRemoteAlias,
  getRemoteRequestId,
} from './federationRuntime.js';

function getReactSharedProvider(snapshot) {
  const reactShare =
    snapshot.runtime.shareScope.find((shared) => shared.key === 'react') ||
    snapshot.runtime.registeredShared.find((shared) => shared.key === 'react');
  return reactShare?.versions?.[0] || null;
}

function createServerFederationDebug(remoteManifestUrl) {
  const snapshot = getFederationDebugInfo();
  const remoteAlias = getRemoteAlias();
  const registeredRemotes = snapshot.runtime.registeredManifestRemotes.filter(
    (remote) => remote.alias === remoteAlias && remote.target === 'node',
  );
  const registeredRemote =
    registeredRemotes.find((remote) => remote.manifestUrl === remoteManifestUrl) ||
    registeredRemotes.at(-1) ||
    null;

  return {
    manifestUrl: remoteManifestUrl,
    react: {
      sharedProvider: getReactSharedProvider(snapshot),
      version: React.version,
    },
    remoteAlias,
    remoteId: getRemoteRequestId(),
    registeredRemote,
    shareScope: registeredRemote?.shareScope || 'default',
    target: 'node',
  };
}

export async function render(
  remoteManifestUrl = DEFAULT_REMOTE_MANIFEST_URL,
  manifestOptions = {},
) {
  ensureServerFederation();

  const [remoteManifest, remoteModule] = await Promise.all([
    fetchFederationManifest(remoteManifestUrl, manifestOptions),
    loadRemoteFromManifest(getRemoteRequestId(), remoteManifestUrl, {
      ...manifestOptions,
      target: 'node',
    }),
  ]);

  const RemoteButton = remoteModule.default ?? remoteModule;
  const buttonProps = {
    label: 'SSR rendered via Node runtime',
  };

  return {
    appHtml: renderToString(<AppShell RemoteButton={RemoteButton} buttonProps={buttonProps} />),
    buttonProps,
    federationDebug: createServerFederationDebug(remoteManifestUrl),
    remoteManifest,
  };
}
