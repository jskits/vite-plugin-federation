export const packageName = '@mf-examples/workspace-shared';
export const version = '1.0.0';

export function createWorkspaceReport(consumer) {
  return {
    consumer,
    packageName,
    resolvedFrom: 'pnpm-workspace-symlink',
    version,
  };
}

export default {
  createWorkspaceReport,
  packageName,
  version,
};
