#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { lintOpenApi } from './scripts/openapi-lint-and-compatibility.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_ROOT = path.resolve(HERE, '..', 'specs', '014-governed-hostinger-storage-orchestration');
const CONTRACT_ROOT = path.join(SPEC_ROOT, 'contracts');
const OPENAPI_PATH = path.join(CONTRACT_ROOT, 'openapi.yaml');
const BASELINE_PATH = path.join(CONTRACT_ROOT, 'contract-compatibility-baseline.json');
const ERROR_CATALOG_PATH = path.join(SPEC_ROOT, 'error-catalog.md');
const METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
const FORBIDDEN_PROPERTY_NAMES = new Set([
  'password',
  'secret',
  'token',
  'private_key',
  'credential',
  'raw_provider_output',
  'raw_environment',
  'file_content'
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function operationEntries(document) {
  const result = [];
  for (const [route, pathItem] of Object.entries(document.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (METHODS.has(method.toLowerCase()) && operation && typeof operation === 'object') {
        result.push({ key: `${method.toUpperCase()} ${route}`, operation });
      }
    }
  }
  return result.sort((left, right) => left.key.localeCompare(right.key));
}

function walk(value, visit, location = '#') {
  visit(value, location);
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, visit, `${location}/${index}`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    walk(child, visit, `${location}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`);
  }
}

function collectExternalRefs(document) {
  const refs = new Set();
  walk(document, (value) => {
    if (value && typeof value === 'object' && typeof value.$ref === 'string' && !value.$ref.startsWith('#/')) {
      refs.add(value.$ref);
    }
  });
  return [...refs].sort();
}

function schemaContractIssues(schema, label) {
  const issues = [];
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    issues.push(`${label}: JSON Schema Draft 2020-12 is required.`);
  }
  if (schema.type !== 'object' || schema.additionalProperties !== false) {
    issues.push(`${label}: root object must be closed.`);
  }
  if (!Array.isArray(schema.required) || !schema.required.includes('secrets_included')) {
    issues.push(`${label}: root secrets_included must be required.`);
  }
  if (schema.properties?.secrets_included?.const !== false) {
    issues.push(`${label}: secrets_included must be const false.`);
  }

  walk(schema, (value, location) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (value.properties && typeof value.properties === 'object') {
      if (value.additionalProperties !== false) issues.push(`${label}:${location}: object properties must be closed.`);
      for (const name of value.required || []) {
        if (!Object.hasOwn(value.properties, name)) issues.push(`${label}:${location}: required property ${name} is undeclared.`);
      }
      for (const propertyName of Object.keys(value.properties)) {
        if (propertyName === 'secrets_included') continue;
        const normalized = propertyName.toLowerCase();
        if (FORBIDDEN_PROPERTY_NAMES.has(normalized)) {
          issues.push(`${label}:${location}: credential-like property ${propertyName} is forbidden.`);
        }
      }
    }
  });
  return issues;
}

const baseline = readJson(BASELINE_PATH);
const document = YAML.parse(fs.readFileSync(OPENAPI_PATH, 'utf8'));

assert.equal(baseline.schema_version, 1);
assert.equal(baseline.compatibility_mode, 'additive_only');
assert.equal(baseline.secrets_included, false);
assert.deepEqual(lintOpenApi(document), [], 'Hostinger OpenAPI must pass repository lint rules.');
assert.equal(document.openapi, baseline.openapi_version);
assert.equal(document.info?.version, baseline.info_version);

const operations = Object.fromEntries(operationEntries(document).map(({ key, operation }) => [key, operation.operationId]));
assert.deepEqual(operations, baseline.operations, 'Paths, methods, and operationIds must match the compatibility floor.');
assert.equal(Object.keys(operations).length, 18);
assert.equal(new Set(Object.values(operations)).size, 18, 'operationIds must remain unique.');

const externalRefs = collectExternalRefs(document);
assert.deepEqual(externalRefs, baseline.external_schemas);
for (const reference of externalRefs) {
  assert(reference.startsWith('./'), `External schema ref must remain local: ${reference}`);
  assert(fs.existsSync(path.resolve(CONTRACT_ROOT, reference)), `External schema ref is missing: ${reference}`);
}

const schemaFiles = baseline.external_schemas.map((reference) => reference.slice(2));
for (const schemaFile of schemaFiles) {
  const schema = readJson(path.join(CONTRACT_ROOT, schemaFile));
  assert.deepEqual(schemaContractIssues(schema, schemaFile), [], `${schemaFile} violates the closed no-secret schema contract.`);
}

const planSchema = readJson(path.join(CONTRACT_ROOT, 'storage-plan.schema.json'));
const relativePathPattern = planSchema.properties?.items?.items?.properties?.relative_path?.pattern;
assert.equal(relativePathPattern, '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+$');

const catalogCodes = fs.readFileSync(ERROR_CATALOG_PATH, 'utf8')
  .split(/\r?\n/)
  .map((line) => /^\| (STORAGE_[A-Z0-9_]+) \|/.exec(line)?.[1] || null)
  .filter(Boolean);
assert.equal(new Set(catalogCodes).size, catalogCodes.length, 'Error catalog codes must be unique.');
assert.deepEqual(catalogCodes, baseline.error_codes, 'Error codes are append-only and must match the compatibility floor.');
assert.equal(catalogCodes.length, 59);

const missingSecurity = clone(document);
delete missingSecurity.security;
assert(lintOpenApi(missingSecurity).some((issue) => issue.includes('Top-level security is required')));

const duplicateOperation = clone(document);
const duplicateEntries = operationEntries(duplicateOperation);
duplicateEntries[1].operation.operationId = duplicateEntries[0].operation.operationId;
assert(lintOpenApi(duplicateOperation).some((issue) => issue.includes('duplicates operationId')));

const unresolvedReference = clone(document);
unresolvedReference.paths['/admin/hosting/storage/release-preflight'].post.responses['200'].content['application/json'].schema = {
  $ref: '#/components/schemas/ContractThatDoesNotExist'
};
assert(lintOpenApi(unresolvedReference).some((issue) => issue.includes('unresolved internal $ref')));

const malformedRequired = clone(document);
malformedRequired.components.schemas.MalformedContract = {
  type: 'object',
  additionalProperties: false,
  required: ['missing_property'],
  properties: {}
};
assert(lintOpenApi(malformedRequired).some((issue) => issue.includes('requires missing property missing_property')));

const missingNoSecretMarker = clone(planSchema);
delete missingNoSecretMarker.properties.secrets_included;
assert(schemaContractIssues(missingNoSecretMarker, 'negative-missing-secret-marker').length > 0);

const credentialField = clone(planSchema);
credentialField.properties.password = { type: 'string' };
assert(schemaContractIssues(credentialField, 'negative-credential-field').some((issue) => issue.includes('credential-like property password')));

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_contracts',
  operations: Object.keys(operations).length,
  external_schemas: schemaFiles.length,
  error_codes: catalogCodes.length,
  negative_cases: 6,
  secrets_included: false
}));
