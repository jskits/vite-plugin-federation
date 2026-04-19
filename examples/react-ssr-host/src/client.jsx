import { hydrateRoot } from 'react-dom/client';
import { loadRemoteFromManifest } from 'vite-plugin-federation/runtime';
import { AppShell } from './AppShell.jsx';
import {
  ensureBrowserFederation,
  getRemoteManifestUrl,
  getRemoteRequestId,
} from './federationRuntime.js';
import './app.css';

async function bootstrap() {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('Missing #root container.');
  }

  ensureBrowserFederation();
  const remoteModule = await loadRemoteFromManifest(getRemoteRequestId(), getRemoteManifestUrl());
  const RemoteButton = remoteModule.default ?? remoteModule;
  const buttonProps = window.__REMOTE_BUTTON_PROPS__ || {
    label: 'SSR rendered via Node runtime',
  };

  hydrateRoot(root, <AppShell RemoteButton={RemoteButton} buttonProps={buttonProps} />);
}

bootstrap().catch((error) => {
  console.error('[react-ssr-host] hydration failed', error);
});
