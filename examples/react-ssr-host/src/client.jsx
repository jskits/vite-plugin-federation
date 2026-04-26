import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { getFederationDebugInfo, loadRemoteFromManifest } from 'vite-plugin-federation/runtime';
import { AppShell } from './AppShell.jsx';
import {
  ensureBrowserFederation,
  getRemoteAlias,
  getRemoteManifestUrl,
  getRemoteRequestId,
} from './federationRuntime.js';
import './app.css';

function getReactSharedProvider(snapshot) {
  const reactShare =
    snapshot.runtime.shareScope.find((shared) => shared.key === 'react') ||
    snapshot.runtime.registeredShared.find((shared) => shared.key === 'react');
  return reactShare?.versions?.[0] || null;
}

function createHydrationFederationDebug(manifestUrl) {
  const snapshot = getFederationDebugInfo();
  const remoteAlias = getRemoteAlias();
  const registeredRemote =
    snapshot.runtime.registeredManifestRemotes.find(
      (remote) => remote.alias === remoteAlias && remote.target === 'web',
    ) || null;

  return {
    manifestUrl,
    react: {
      sharedProvider: getReactSharedProvider(snapshot),
      version: React.version,
    },
    remoteAlias,
    remoteId: getRemoteRequestId(),
    registeredRemote,
    shareScope: registeredRemote?.shareScope || 'default',
    target: 'web',
  };
}

function assertHydrationFederationCompatibility(serverDebug, clientDebug) {
  if (!serverDebug) {
    return;
  }

  const mismatches = [];
  if (serverDebug.manifestUrl !== clientDebug.manifestUrl) {
    mismatches.push(
      `manifest URL server=${serverDebug.manifestUrl} client=${clientDebug.manifestUrl}`,
    );
  }
  if (serverDebug.remoteId !== clientDebug.remoteId) {
    mismatches.push(`remote id server=${serverDebug.remoteId} client=${clientDebug.remoteId}`);
  }
  if (serverDebug.shareScope !== clientDebug.shareScope) {
    mismatches.push(
      `share scope server=${serverDebug.shareScope} client=${clientDebug.shareScope}`,
    );
  }
  if (serverDebug.react?.version !== clientDebug.react?.version) {
    mismatches.push(
      `react version server=${serverDebug.react?.version} client=${clientDebug.react?.version}`,
    );
  }

  if (mismatches.length > 0) {
    throw new Error(`[react-ssr-host] hydration federation mismatch: ${mismatches.join('; ')}`);
  }
}

async function bootstrap() {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Missing #root container.');
  }

  ensureBrowserFederation();
  const remoteManifestUrl = getRemoteManifestUrl();
  const remoteModule = await loadRemoteFromManifest(getRemoteRequestId(), remoteManifestUrl);
  const RemoteButton = remoteModule.default ?? remoteModule;
  const buttonProps = window.__REMOTE_BUTTON_PROPS__ || {
    label: 'SSR rendered via Node runtime',
  };
  const hydrationFederationDebug = createHydrationFederationDebug(remoteManifestUrl);
  assertHydrationFederationCompatibility(window.__SSR_FEDERATION_DEBUG__, hydrationFederationDebug);
  window.__SSR_HYDRATION_DEBUG__ = hydrationFederationDebug;

  hydrateRoot(root, <AppShell RemoteButton={RemoteButton} buttonProps={buttonProps} />);
}

bootstrap().catch((error) => {
  console.error('[react-ssr-host] hydration failed', error);
});
