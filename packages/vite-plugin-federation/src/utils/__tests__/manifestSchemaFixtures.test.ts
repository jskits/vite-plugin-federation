import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { isSupportedFederationManifestSchemaVersion } from '../manifestProtocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../../..');

async function readJsonFixture(relativePath: string) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf-8')) as Record<
    string,
    unknown
  >;
}

async function createSchemaValidators() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  const manifestSchema = await readJsonFixture('docs/schemas/mf-manifest.schema.json');
  const statsSchema = await readJsonFixture('docs/schemas/mf-stats.schema.json');
  const debugSchema = await readJsonFixture('docs/schemas/mf-debug.schema.json');

  ajv.addSchema(manifestSchema, './mf-manifest.schema.json');

  return {
    debug: ajv.compile(debugSchema),
    manifest: ajv.getSchema(String(manifestSchema.$id)) || ajv.compile(manifestSchema),
    stats: ajv.compile(statsSchema),
  };
}

describe('manifest protocol schema fixtures', () => {
  it.each([
    ['manifest', 'docs/fixtures/manifest-protocol/v1/mf-manifest.json'],
    ['stats', 'docs/fixtures/manifest-protocol/v1/mf-stats.json'],
    ['debug', 'docs/fixtures/manifest-protocol/v1/mf-debug.json'],
  ] as const)(
    'validates the v1 %s fixture against the committed JSON Schema',
    async (kind, file) => {
      const validators = await createSchemaValidators();
      const fixture = await readJsonFixture(file);
      const validate = validators[kind];

      expect(validate(fixture), JSON.stringify(validate.errors, null, 2)).toBe(true);
    },
  );

  it.each([
    {
      file: 'docs/fixtures/manifest-protocol/compat/legacy-mf-manifest.json',
      schemaVersion: undefined,
      supported: true,
    },
    {
      file: 'docs/fixtures/manifest-protocol/compat/future-minor-mf-manifest.json',
      schemaVersion: '1.1.0',
      supported: true,
    },
    {
      file: 'docs/fixtures/manifest-protocol/compat/future-major-mf-manifest.json',
      schemaVersion: '2.0.0',
      supported: false,
    },
  ])('documents runtime compatibility for $file', async ({ file, schemaVersion, supported }) => {
    const validators = await createSchemaValidators();
    const fixture = await readJsonFixture(file);

    expect(fixture.schemaVersion).toBe(schemaVersion);
    expect(validators.manifest(fixture)).toBe(false);
    expect(isSupportedFederationManifestSchemaVersion(fixture.schemaVersion)).toBe(supported);
  });
});
