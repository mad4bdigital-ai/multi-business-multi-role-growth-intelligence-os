import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const artifactPath = path.join(root, "specs/020-platform-resource-identity-brand-governance/openapi-detail-closure-batch-full.json");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));

assert.equal(artifact.schema_version, "spec020-openapi-detail-closure-batch-v1");
assert.equal(artifact.status, "shadow_detail_evidence_batch");
assert.equal(artifact.batch_id, "spec020-openapi-detail-closure-batch-full");
assert.deepEqual(artifact.scope_boundary, {
  route_wiring: false,
  runtime_authority: false,
  rest_projection: false,
  custom_gpt_projection: false,
  remote_mcp_projection: false,
  frontend_projection: false,
  database_write: false,
  migration_apply: false,
  grant_execution: false,
  provider_call: false,
  credential_read: false,
  production_activation: false,
});
assert.equal(artifact.source.family_count, 168);
assert.equal(artifact.source.detail_family_count, 74);
assert.equal(artifact.source.dispatch_operation_count, 1041);
assert.equal(artifact.summary.family_count, 74);
assert.equal(artifact.summary.dispatch_family_count, 168);
assert.equal(artifact.summary.operation_count, 315);
assert.equal(artifact.operations.length, 315);

const signatures = new Set();
for (const operation of artifact.operations) {
  const operationKey = `${operation.family_key}:${operation.signature}:${operation.source_file}`;
  assert(!signatures.has(operationKey), `duplicate operation: ${operationKey}`);
  signatures.add(operationKey);
  assert.equal(operation.openapi_contract_level, "operation-index-only");
  assert.equal(operation.auth_parity, "equivalent");
  assert.equal(operation.closure_status, "detail_evidence_required");
  assert.equal(operation.canonical_openapi_added, false);
  assert.equal(operation.route_wiring, false);
  assert.equal(operation.runtime_authority, false);
  assert.equal(operation.production_activation, false);
}

console.log(JSON.stringify({
  ok: true,
  contract: artifact.schema_version,
  batch_id: artifact.batch_id,
  operation_count: artifact.operations.length,
  route_wiring: artifact.scope_boundary.route_wiring,
  runtime_authority: artifact.scope_boundary.runtime_authority,
  production_activation: artifact.scope_boundary.production_activation,
}));
