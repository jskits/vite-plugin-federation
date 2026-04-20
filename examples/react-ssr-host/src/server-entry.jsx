import { renderToString } from 'react-dom/server';
import { fetchFederationManifest, loadRemoteFromManifest } from 'vite-plugin-federation/runtime';
import { AppShell } from './AppShell.jsx';
import {
  DEFAULT_REMOTE_MANIFEST_URL,
  ensureServerFederation,
  getRemoteRequestId,
} from './federationRuntime.js';

export async function render(remoteManifestUrl = DEFAULT_REMOTE_MANIFEST_URL) {
  ensureServerFederation();

  const [remoteManifest, remoteModule] = await Promise.all([
    fetchFederationManifest(remoteManifestUrl),
    loadRemoteFromManifest(getRemoteRequestId(), remoteManifestUrl, {
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
    remoteManifest,
  };
}
