import { createFilter } from '@rollup/pluginutils';
import { Plugin } from 'vite';
import { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';
import { getInstalledPackageEntry, getIsRolldown } from '../utils/packageUtils';
import { addUsedRemote, getRemoteVirtualModule } from '../virtualModules';
const filter: (id: string) => boolean = createFilter();

function isNodeModulesImporter(importer?: string) {
  return importer?.includes('/node_modules/') || importer?.includes('\\node_modules\\');
}

export default function (options: NormalizedModuleFederationOptions): Plugin {
  let command: string;
  let root = process.cwd();
  const { remotes } = options;

  function resolveRemoteId(
    source: string,
    importer: string | undefined,
    remoteName: string,
    isRolldown: boolean
  ) {
    if (source === remoteName) {
      const installedPackageEntry = getInstalledPackageEntry(source, { cwd: root });
      if (installedPackageEntry && (importer === undefined || isNodeModulesImporter(importer))) {
        return installedPackageEntry;
      }
    }
    const remoteModule = getRemoteVirtualModule(source, command, isRolldown);
    addUsedRemote(remoteName, source);
    return remoteModule.getPath();
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
      for (const remote of Object.values(remotes)) {
        if (source !== remote.name && !source.startsWith(`${remote.name}/`)) continue;
        return resolveRemoteId(source, importer, remote.name, isRolldown);
      }
    },
  };
}
