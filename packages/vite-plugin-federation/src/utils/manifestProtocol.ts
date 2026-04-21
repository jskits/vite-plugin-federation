import { createModuleFederationError } from './logger';

export const FEDERATION_MANIFEST_SCHEMA_VERSION = '1.0.0';
export const FEDERATION_STATS_SCHEMA_VERSION = '1.0.0';
export const FEDERATION_DEBUG_SCHEMA_VERSION = '1.0.0';

const CURRENT_MANIFEST_SCHEMA_MAJOR = getSchemaVersionMajor(FEDERATION_MANIFEST_SCHEMA_VERSION);

function getSchemaVersionMajor(schemaVersion: string) {
  const match = schemaVersion.match(/^(\d+)\.\d+\.\d+$/);
  return match ? Number(match[1]) : null;
}

function formatSchemaVersion(schemaVersion: unknown) {
  if (typeof schemaVersion === 'undefined') {
    return 'undefined';
  }
  return JSON.stringify(schemaVersion);
}

export function isSupportedFederationManifestSchemaVersion(schemaVersion: unknown) {
  if (typeof schemaVersion === 'undefined') {
    return true;
  }
  if (typeof schemaVersion !== 'string') {
    return false;
  }

  const major = getSchemaVersionMajor(schemaVersion);
  return major === CURRENT_MANIFEST_SCHEMA_MAJOR;
}

export function assertSupportedFederationManifestSchemaVersion(
  manifestUrl: string,
  schemaVersion: unknown,
) {
  if (isSupportedFederationManifestSchemaVersion(schemaVersion)) {
    return;
  }

  throw createModuleFederationError(
    'MFV-004',
    `Federation manifest "${manifestUrl}" uses unsupported schemaVersion ${formatSchemaVersion(
      schemaVersion,
    )}. Supported schema major version is ${CURRENT_MANIFEST_SCHEMA_MAJOR}.`,
  );
}
