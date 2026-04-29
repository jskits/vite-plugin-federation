import React from 'react';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';
import * as ReactDomServer from 'react-dom/server';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import {
  createFederationInstance,
  createServerFederationInstance,
} from 'vite-plugin-federation/runtime';

export const DEFAULT_REMOTE_MANIFEST_URL =
  process.env.REACT_REMOTE_MANIFEST_URL || 'http://localhost:4174/mf-manifest.json';
export const DEFAULT_REMOTE_MANIFEST_FALLBACK_URLS = (
  process.env.REACT_REMOTE_MANIFEST_FALLBACK_URLS || ''
)
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

const REMOTE_REQUEST_ID = 'reactRemote/Button';

let browserRuntime;
let serverRuntime;

function createSharedScope(isServer) {
  const shared = {
    react: {
      version: React.version,
      lib: () => React,
      shareConfig: {
        singleton: true,
        requiredVersion: false,
      },
    },
    'react-dom': {
      version: ReactDom.version || React.version,
      lib: () => ReactDom,
      shareConfig: {
        singleton: true,
        requiredVersion: false,
      },
    },
    'react/jsx-runtime': {
      version: React.version,
      lib: () => ReactJsxRuntime,
      shareConfig: {
        singleton: true,
        requiredVersion: false,
      },
    },
  };

  if (isServer) {
    shared['react-dom/server'] = {
      version: React.version,
      lib: () => ReactDomServer,
      shareConfig: {
        singleton: true,
        requiredVersion: false,
      },
    };
  } else {
    shared['react-dom/client'] = {
      version: ReactDom.version || React.version,
      lib: () => ReactDomClient,
      shareConfig: {
        singleton: true,
        requiredVersion: false,
      },
    };
  }

  return shared;
}

export function ensureBrowserFederation() {
  browserRuntime ||= createFederationInstance({
    name: 'reactSsrHostClient',
    remotes: [],
    shared: createSharedScope(false),
    plugins: [],
    shareStrategy: 'loaded-first',
  });

  return browserRuntime;
}

export function ensureServerFederation() {
  serverRuntime ||= createServerFederationInstance({
    name: 'reactSsrHostServer',
    remotes: [],
    shared: createSharedScope(true),
    plugins: [],
    shareStrategy: 'loaded-first',
  });

  return serverRuntime;
}

export function getRemoteManifestUrl() {
  if (typeof window !== 'undefined' && window.__REMOTE_MANIFEST_URL__) {
    return window.__REMOTE_MANIFEST_URL__;
  }
  return DEFAULT_REMOTE_MANIFEST_URL;
}

export function getRemoteManifestFallbackUrls() {
  if (typeof window !== 'undefined' && Array.isArray(window.__REMOTE_MANIFEST_FALLBACK_URLS__)) {
    return window.__REMOTE_MANIFEST_FALLBACK_URLS__;
  }
  return DEFAULT_REMOTE_MANIFEST_FALLBACK_URLS;
}

export function getRemoteRequestId() {
  return REMOTE_REQUEST_ID;
}

export function getRemoteAlias() {
  return REMOTE_REQUEST_ID.split('/')[0];
}
