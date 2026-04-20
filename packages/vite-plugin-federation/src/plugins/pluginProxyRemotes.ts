import { createFilter } from '@rollup/pluginutils';
import type { Plugin } from 'vite';
import { getDevRemoteVersion } from '../utils/devRemoteVersionState';
import type { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';
import { getInstalledPackageEntry, getIsRolldown } from '../utils/packageUtils';
import { addUsedRemote, getRemoteVirtualModule } from '../virtualModules';
const filter: (id: string) => boolean = createFilter();

function isNodeModulesImporter(importer?: string) {
  return importer?.includes('/node_modules/') || importer?.includes('\\node_modules\\');
}

function splitSourceQuery(source: string) {
  const match = source.match(/^([^?#]+)(.*)$/);
  return {
    cleanSource: match?.[1] || source,
    suffix: match?.[2] || '',
  };
}

export default function (options: NormalizedModuleFederationOptions): Plugin {
  let command: string;
  let root = process.cwd();
  const { remotes } = options;

  function resolveRemoteId(
    source: string,
    importer: string | undefined,
    remoteName: string,
    isRolldown: boolean,
  ) {
    const { cleanSource, suffix } = splitSourceQuery(source);

    if (cleanSource === remoteName) {
      const installedPackageEntry = getInstalledPackageEntry(cleanSource, { cwd: root });
      if (installedPackageEntry && (importer === undefined || isNodeModulesImporter(importer))) {
        return installedPackageEntry;
      }
    }
    const remoteModule = getRemoteVirtualModule(cleanSource, command, isRolldown);
    const resolvedVersion =
      command === 'serve' ? getDevRemoteVersion(options.internalName, cleanSource) : undefined;
    const query = suffix || (resolvedVersion ? `?t=${resolvedVersion}` : '');

    addUsedRemote(remoteName, cleanSource);
    return `${remoteModule.getPath()}${query}`;
  }

  return {
    name: 'proxyRemotes',
    enforce: 'pre',
    config(config, { command: _command }) {
      command = _command;
      root = config.root || process.cwd();
    },
    resolveId(source, importer) {
      if (!filter(source)) return;
      const isRolldown = getIsRolldown(this);
      const { cleanSource } = splitSourceQuery(source);
      for (const remote of Object.values(remotes)) {
        if (cleanSource !== remote.name && !cleanSource.startsWith(`${remote.name}/`)) continue;
        return resolveRemoteId(source, importer, remote.name, isRolldown);
      }
    },
  };
}
