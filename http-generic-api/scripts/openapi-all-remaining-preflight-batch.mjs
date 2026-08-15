#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../../', import.meta.url).pathname;
const dispatchPath = `${root}http-generic-api/frontend-surface-dispatch.generated.json`;
const outputPath = `${root}specs/020-platform-resource-identity-brand-governance/openapi-all-remaining-preflight-batch.json`;
const dispatch = JSON.parse(fs.readFileSync(dispatchPath, 'utf8'));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function collect(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, result);
    return result;
  }
  if (value && typeof value === 'object') {
    if (value.openapi_contract_level === 'operation-index-only') result.push(value);
    for (const child of Object.values(value)) collect(child, result);
  }
  return result;
}

const operations = collect(dispatch).sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
const dispatchHash = sha256(fs.readFileSync(dispatchPath));
const prepared = operations.map((operation) => {
  const mutation = operation.mutation_candidate === true || operation.governance?.classification === 'disabled';
  return {
    family_key: operation.family_key ?? null,
    method: operation.method,
    path: operation.path,
    signature: operation.signature,
    scope: operation.scope,
    source_file: operation.source_file,
    openapi_contract_level: operation.openapi_contract_level,
    openapi_documented: operation.openapi_documented === true,
    openapi_canonical_documented: operation.openapi_canonical_documented === true,
    auth_parity: operation.auth_parity,
    governance_classification: operation.governance?.classification ?? null,
    mutation_candidate: operation.mutation_candidate === true,
    prepared_contract: {
      mode: 'prepared_only',
      preflight_required: true,
      approval_required: mutation,
      readback_required: mutation,
      rollback_required: mutation,
      route_wiring: false,
      runtime_authority: false,
      migration_execution: false,
      provider_mutation: false,
      production_activation: false,
      secrets_included: false
    },
    evidence_refs: [
      'http-generic-api/frontend-surface-dispatch.generated.json',
      'http-generic-api/test-frontend-surface-coverage-claims.mjs',
      operation.source_file,
      'specs/020-platform-resource-identity-brand-governance/openapi-gap-closure-plan.json'
    ]
  };
});

const artifact = {
  $schema: './contracts/openapi-all-remaining-preflight-batch.schema.json',
  schema_version: 1,
  contract: 'spec020-openapi-all-remaining-preflight-batch-v1',
  batch_id: 'spec020-openapi-all-remaining-preflight-batch-03',
  source: {
    dispatch_path: 'http-generic-api/frontend-surface-dispatch.generated.json',
    dispatch_sha256: dispatchHash,
    contract_level: 'operation-index-only',
    detail_gap_scope: 'all_remaining'
  },
  coverage: {
    operation_count: prepared.length,
    expected_detail_gap_count: 315,
    operation_count_matches_expected: prepared.length === 315,
    all_operations_prepared_only: prepared.every((item) => item.prepared_contract.mode === 'prepared_only'),
    route_wiring: false,
    runtime_authority: false,
    production_activation: false
  },
  operations: prepared
};

if (process.argv.includes('--check')) {
  const current = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const expected = JSON.stringify(artifact, null, 2) + '\n';
  const actual = JSON.stringify(current, null, 2) + '\n';
  if (expected !== actual) throw new Error(`artifact is stale: ${outputPath}`);
  if (!artifact.coverage.operation_count_matches_expected) throw new Error(`expected 315 remaining detail gaps, got ${prepared.length}`);
  console.log(JSON.stringify({ ok: true, mode: 'check', batch_id: artifact.batch_id, operation_count: prepared.length, route_wiring: false, runtime_authority: false, production_activation: false }));
} else {
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, mode: 'write', output: outputPath, operation_count: prepared.length }));
}
