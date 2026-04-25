import type { Plugin } from 'vite';
import type { NormalizedModuleFederationOptions } from '../utils/normalizeModuleFederationOptions';

const ORIGINJS_VIRTUAL_ID = 'virtual:__federation__';
const RESOLVED_ORIGINJS_VIRTUAL_ID = '\0vite-plugin-federation:originjs-compat';

function getRemoteFormat(type?: string, format?: string): string {
  if (format) return format;
  if (type === 'var') return 'var';
  if (type === 'system') return 'systemjs';
  return 'esm';
}

export default function pluginOriginjsCompat(options: NormalizedModuleFederationOptions): Plugin {
  return {
    name: 'module-federation-originjs-compat',
    resolveId(id) {
      if (!options.compat.originjs || !options.compat.virtualFederationShim) return;
      if (id === ORIGINJS_VIRTUAL_ID) {
        return RESOLVED_ORIGINJS_VIRTUAL_ID;
      }
    },
    load(id) {
      if (id !== RESOLVED_ORIGINJS_VIRTUAL_ID) return;

      const remotes = Object.fromEntries(
        Object.entries(options.remotes).map(([remoteName, remote]) => [
          remoteName,
          {
            url: remote.entry,
            format: getRemoteFormat(remote.type, remote.format),
            from: remote.from || 'vite',
            entryGlobalName: remote.entryGlobalName || remoteName,
            shareScope: remote.shareScope || 'default',
          },
        ]),
      );

      return `
        import { loadRemote, registerRemotes } from "@module-federation/runtime";

        const remotesMap = ${JSON.stringify(remotes)};
        const remoteContainers = Object.create(null);
        const compatWarnings = new Set();

        function __federation_method_unwrapDefault(module) {
          return module?.__esModule || module?.[Symbol.toStringTag] === "Module"
            ? module.default
            : module;
        }

        function __federation_method_wrapDefault(module, need) {
          if (!module?.default && need) {
            return {
              default: module,
              __esModule: true,
            };
          }
          return module;
        }

        function formatCompatMessage(code, message) {
          return "[Module Federation] " + code + " " + message;
        }

        function createCompatError(code, message) {
          return new Error(formatCompatMessage(code, message));
        }

        function warnCompatOnce(code, key, message) {
          if (compatWarnings.has(key)) {
            return;
          }
          compatWarnings.add(key);
          console.warn(formatCompatMessage(code, message));
        }

        function normalizeCompatFormat(format) {
          if (format === "module") return "esm";
          if (format === "system") return "systemjs";
          return format || "esm";
        }

        function validateCompatRemote(remoteName, remote) {
          if (!remote) {
            throw createCompatError("MFV-005", "Unknown remote: " + remoteName);
          }

          const normalizedFormat = normalizeCompatFormat(remote.format);
          const normalizedFrom = typeof remote.from === "string" && remote.from.length > 0
            ? remote.from
            : "vite";

          if (
            normalizedFormat !== "esm" &&
            normalizedFormat !== "var" &&
            normalizedFormat !== "systemjs"
          ) {
            throw createCompatError(
              "MFV-005",
              'Legacy remote "' +
                remoteName +
                '" uses unsupported format "' +
                normalizedFormat +
                '". Supported formats are "esm", "var", and "systemjs".',
            );
          }

          if (normalizedFrom !== "vite" && normalizedFrom !== "webpack") {
            warnCompatOnce(
              "MFV-007",
              "from:" + remoteName + ":" + normalizedFrom,
              'Legacy remote "' +
                remoteName +
                '" uses unsupported from "' +
                normalizedFrom +
                '". Expected "vite" or "webpack"; compatibility is not guaranteed.',
            );
          }

          if (normalizedFormat === "systemjs") {
            const systemRuntime = globalThis.System;
            if (!systemRuntime || typeof systemRuntime.import !== "function") {
              throw createCompatError(
                "MFV-005",
                'Legacy remote "' +
                  remoteName +
                  '" uses format "systemjs" but globalThis.System.import is unavailable.',
              );
            }
          }

          return {
            ...remote,
            format: normalizedFormat,
            from: normalizedFrom,
            shareScope: remote.shareScope || "default",
          };
        }

        function __federation_method_setRemote(remoteName, remoteConfig) {
          remotesMap[remoteName] = validateCompatRemote(remoteName, remoteConfig);
          delete remoteContainers[remoteName];
        }

        function normalizeRemoteRequest(remoteName, componentName) {
          if (!componentName || componentName === "." || componentName === "./") {
            return remoteName;
          }
          if (componentName.startsWith(remoteName)) {
            return componentName;
          }
          if (componentName.startsWith("./")) {
            return remoteName + "/" + componentName.slice(2);
          }
          return remoteName + "/" + componentName;
        }

        function mapFormatToType(format) {
          if (format === "var") return "var";
          if (format === "systemjs") return "system";
          return "module";
        }

        async function registerRemote(remoteName) {
          const remote = validateCompatRemote(remoteName, remotesMap[remoteName]);
          remotesMap[remoteName] = remote;

          const entry = typeof remote.url === "function" ? await remote.url() : remote.url;
          registerRemotes(
            [
              {
                name: remoteName,
                entry,
                type: mapFormatToType(remote.format),
                entryGlobalName: remote.entryGlobalName || remoteName,
                shareScope: remote.shareScope || "default",
              },
            ],
            { force: true }
          );

          return remote;
        }

        async function __federation_method_ensure(remoteName) {
          await registerRemote(remoteName);

          if (!remoteContainers[remoteName]) {
            remoteContainers[remoteName] = {
              async get(componentName) {
                const request = normalizeRemoteRequest(remoteName, componentName);
                return () => loadRemote(request);
              },
              async init() {
                return undefined;
              },
            };
          }

          return remoteContainers[remoteName];
        }

        function __federation_method_getRemote(remoteName, componentName) {
          return __federation_method_ensure(remoteName).then((remote) =>
            remote.get(componentName).then((factory) => factory())
          );
        }

        export {
          __federation_method_ensure,
          __federation_method_getRemote,
          __federation_method_setRemote,
          __federation_method_unwrapDefault,
          __federation_method_wrapDefault
        };
      `;
    },
  };
}
