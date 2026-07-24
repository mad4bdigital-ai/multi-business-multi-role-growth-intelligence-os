import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { operationRevisionHash, stableOperationHash } from "./operationRegistryContracts.js";
import { persistOperationRunRevisionPin } from "./operationRunRevisionRepository.js";

const migration = readFileSync(new URL("./migrations/20260724_operation_run_revision_pinning.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS operation_run_revision_pins/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS operation_run_revision_items/);
assert.match(migration, /UNIQUE KEY uq_operation_run_revision_pins_run_id \(run_id\)/);
assert.match(migration, /UNIQUE KEY uq_operation_run_revision_items_identity \(run_id, revision_type, revision_key\)/);
assert.match(migration, /FOREIGN KEY \(run_id\) REFERENCES operation_run_ownership \(run_id\)/);
assert.match(migration, /FOREIGN KEY \(manifest_id\) REFERENCES operation_compiled_manifests \(manifest_id\)/);
assert.match(migration, /ENUM\('contract','step','binding','policy','schema'\)/);
const sqlWithoutComments = migration.replace(/--.*$/gm, "");
assert.doesNotMatch(sqlWithoutComments, /(?:^|;)\s*(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w|INSERT\s+INTO|RENAME\s+TABLE)\b/im);

function operationDefinition() {
  return {
    operation_key: "repo.change.preview",
    version: 1,
    display_name: "Repository Change Preview",
    description: "Build a bounded repository preview.",
    operation_class: "repository",
    scope_type: "admin",
    risk_level: "medium",
    execution_mode: "synchronous",
    input_schema_json: { type: "object", properties: { branch: { type: "string" } }, required: ["branch"], additionalProperties: false },
    output_schema_json: { type: "object", properties: { status: { type: "string" } }, required: ["status"], additionalProperties: false },
    status: "active",
    source_revision_hash: "1".repeat(64),
    compiler_version: "operation-registry-v1",
    metadata_json: { owner: "spec-011", secrets_included: false },
    created_by: "platform_admin_service",
    steps: [{
      step_key: "preview",
      step_order: 10,
      depends_on: [],
      handler_key: "repository_preview",
      capability_key: "repository_read",
      input_mapping_json: null,
      success_condition_json: null,
      retry_policy_json: null,
      failure_policy_json: null,
      timeout_seconds: 30,
      compensation_required: false,
      compensation_policy_key: null,
      status: "active",
      metadata_json: null
    }]
  };
}

function revision(type, key, order, snapshot, hash = null) {
  return {
    revision_type: type,
    revision_key: key,
    revision_order: order,
    revision_hash: hash || stableOperationHash(snapshot),
    snapshot
  };
}

function input() {
  const contract = operationDefinition();
  return {
    run_id: "11111111-1111-4111-8111-111111111111",
    operation_key: "repo.change.preview",
    operation_version: 1,
    manifest_id: "22222222-2222-4222-8222-222222222222",
    manifest_hash: "2".repeat(64),
    source_revision_hash: "3".repeat(64),
    scope_fingerprint: "4".repeat(64),
    resource_fingerprint: "5".repeat(64),
    input_sha256: "6".repeat(64),
    idempotency_key_sha256: "7".repeat(64),
    requested_by: "platform_admin_service",
    revisions: [
      revision("contract", "repo.change.preview.v1", 0, contract, operationRevisionHash(contract)),
      revision("step", "preview", 10, contract.steps[0]),
      revision("binding", "dispatch.repository.preview", 0, { binding_id: "binding-1", dispatch_binding_key: "dispatch.repository.preview", revision_hash: "8".repeat(64), secrets_included: false }),
      revision("policy", "repository-preview-readback-v1", 0, { policy_key: "repository-preview-readback-v1", policy_version: 1, requires_readback: true }),
      revision("schema", "input", 0, contract.input_schema_json),
      revision("schema", "output", 1, contract.output_schema_json)
    ]
  };
}

function expectedBundleHash(value) {
  const revisions = [...value.revisions].sort((left, right) => {
    const order = { contract: 1, step: 2, binding: 3, policy: 4, schema: 5 };
    return order[left.revision_type] - order[right.revision_type]
      || left.revision_order - right.revision_order
      || left.revision_key.localeCompare(right.revision_key);
  });
  return stableOperationHash({
    schema_version: "operation-run-revision-bundle-v1",
    run_id: value.run_id,
    operation_key: value.operation_key,
    operation_version: value.operation_version,
    manifest_id: value.manifest_id,
    manifest_hash: value.manifest_hash,
    source_revision_hash: value.source_revision_hash,
    scope_fingerprint: value.scope_fingerprint,
    resource_fingerprint: value.resource_fingerprint,
    input_sha256: value.input_sha256,
    idempotency_key_sha256: value.idempotency_key_sha256,
    revisions: revisions.map(({ revision_type, revision_key, revision_order, revision_hash }) => ({ revision_type, revision_key, revision_order, revision_hash }))
  });
}

function scriptedPool(script) {
  const lifecycle = { began: 0, committed: 0, rolledBack: 0, released: 0 };
  const connection = {
    async beginTransaction() { lifecycle.began += 1; },
    async commit() { lifecycle.committed += 1; },
    async rollback() { lifecycle.rolledBack += 1; },
    release() { lifecycle.released += 1; },
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      const next = script.shift();
      assert.ok(next, `unexpected SQL: ${compact}`);
      assert.match(compact, next.match);
      if (next.inspect) next.inspect(params, compact);
      return next.result;
    }
  };
  return {
    pool: { async getConnection() { return connection; } },
    lifecycle,
    remaining: () => script.length
  };
}

function readbackRows(value, pinId) {
  const contractRevisionHash = value.revisions.find((item) => item.revision_type === "contract").revision_hash;
  const bundleHash = expectedBundleHash(value);
  const sorted = [...value.revisions].sort((left, right) => {
    const order = { contract: 1, step: 2, binding: 3, policy: 4, schema: 5 };
    return order[left.revision_type] - order[right.revision_type]
      || left.revision_order - right.revision_order
      || left.revision_key.localeCompare(right.revision_key);
  });
  return {
    operation: { id: 7, operation_id: "operation-1", operation_key: value.operation_key, version: 1, revision_hash: contractRevisionHash, status: "active" },
    manifest: {
      manifest_id: value.manifest_id,
      operation_registry_id: 7,
      manifest_hash: value.manifest_hash,
      source_revision_hash: value.source_revision_hash,
      scope_fingerprint: value.scope_fingerprint,
      validation_status: "valid",
      rollout_mode: "shadow",
      certification_status: "certified",
      expires_at: "2026-08-01T00:00:00.000Z",
      revoked_at: null,
      is_current: 1
    },
    pin: {
      pin_id: pinId,
      run_id: value.run_id,
      operation_registry_id: 7,
      operation_id: "operation-1",
      manifest_id: value.manifest_id,
      operation_key: value.operation_key,
      operation_version: 1,
      scope_fingerprint: value.scope_fingerprint,
      manifest_hash: value.manifest_hash,
      source_revision_hash: value.source_revision_hash,
      resource_fingerprint: value.resource_fingerprint,
      input_sha256: value.input_sha256,
      idempotency_key_sha256: value.idempotency_key_sha256,
      requested_by: value.requested_by,
      revision_bundle_hash: bundleHash,
      created_at: "2026-07-24T13:00:00.000Z"
    },
    items: sorted.map((item) => ({
      revision_type: item.revision_type,
      revision_key: item.revision_key,
      revision_order: item.revision_order,
      revision_hash: item.revision_hash,
      snapshot_json: JSON.stringify(item.snapshot),
      created_at: "2026-07-24T13:00:00.000Z"
    }))
  };
}

{
  const value = input();
  const pinId = "33333333-3333-4333-8333-333333333333";
  const rows = readbackRows(value, pinId);
  const script = [
    { match: /^SELECT run_id,operation_key FROM operation_run_ownership/, result: [[{ run_id: value.run_id, operation_key: value.operation_key }]] },
    { match: /^SELECT id,operation_id,operation_key,version,revision_hash,status FROM operation_registry/, result: [[rows.operation]] },
    { match: /^SELECT m.manifest_id,m.operation_registry_id,m.manifest_hash/, result: [[rows.manifest]] },
    { match: /^SELECT pin_id,revision_bundle_hash FROM operation_run_revision_pins/, result: [[]] },
    { match: /^INSERT INTO operation_run_revision_pins/, result: [{ affectedRows: 1 }] },
    ...value.revisions.map(() => ({ match: /^INSERT INTO operation_run_revision_items/, result: [{ affectedRows: 1 }] })),
    { match: /^SELECT p.pin_id,p.run_id,p.operation_registry_id/, result: [[rows.pin]] },
    { match: /^SELECT revision_type,revision_key,revision_order,revision_hash,snapshot_json,created_at FROM operation_run_revision_items/, result: [rows.items] }
  ];
  const fake = scriptedPool(script);
  const result = await persistOperationRunRevisionPin(value, { pool: fake.pool, uuid: () => pinId });
  assert.equal(result.ok, true);
  assert.equal(result.inserted, true);
  assert.equal(result.idempotent_replay, false);
  assert.equal(result.readback_complete, true);
  assert.equal(result.record.revisions.length, 6);
  assert.equal(result.database_writes_performed, true);
  assert.equal(result.internal_persistence_only, true);
  assert.equal(result.provider_calls_performed, false);
  assert.equal(result.external_writes_performed, false);
  assert.equal(result.runtime_activation_changed, false);
  assert.equal(fake.lifecycle.committed, 1);
  assert.equal(fake.lifecycle.rolledBack, 0);
  assert.equal(fake.lifecycle.released, 1);
  assert.equal(fake.remaining(), 0);
}

{
  const value = input();
  const pinId = "33333333-3333-4333-8333-333333333333";
  const rows = readbackRows(value, pinId);
  const fake = scriptedPool([
    { match: /^SELECT run_id,operation_key FROM operation_run_ownership/, result: [[{ run_id: value.run_id, operation_key: value.operation_key }]] },
    { match: /^SELECT id,operation_id,operation_key,version,revision_hash,status FROM operation_registry/, result: [[rows.operation]] },
    { match: /^SELECT m.manifest_id,m.operation_registry_id,m.manifest_hash/, result: [[rows.manifest]] },
    { match: /^SELECT pin_id,revision_bundle_hash FROM operation_run_revision_pins/, result: [[{ pin_id: pinId, revision_bundle_hash: rows.pin.revision_bundle_hash }]] },
    { match: /^SELECT p.pin_id,p.run_id,p.operation_registry_id/, result: [[rows.pin]] },
    { match: /^SELECT revision_type,revision_key,revision_order,revision_hash,snapshot_json,created_at FROM operation_run_revision_items/, result: [rows.items] }
  ]);
  const result = await persistOperationRunRevisionPin(value, { pool: fake.pool, uuid: () => { throw new Error("uuid must not be called"); } });
  assert.equal(result.inserted, false);
  assert.equal(result.idempotent_replay, true);
  assert.equal(result.database_writes_performed, false);
  assert.equal(fake.lifecycle.committed, 1);
  assert.equal(fake.lifecycle.rolledBack, 0);
}

{
  const value = input();
  value.revisions[1].revision_hash = "f".repeat(64);
  await assert.rejects(
    persistOperationRunRevisionPin(value, { pool: { async getConnection() { throw new Error("database must not be reached"); } } }),
    (error) => error.code === "operation_run_revision_hash_mismatch"
  );
}

{
  const value = input();
  value.revisions = value.revisions.filter((item) => item.revision_type !== "policy");
  await assert.rejects(
    persistOperationRunRevisionPin(value, { pool: { async getConnection() { throw new Error("database must not be reached"); } } }),
    (error) => error.code === "operation_run_revision_required_types_missing"
  );
}

{
  const value = input();
  const snapshot = { policy_key: "unsafe", access_token: "forbidden" };
  value.revisions[3] = revision("policy", "unsafe", 0, snapshot);
  await assert.rejects(
    persistOperationRunRevisionPin(value, { pool: { async getConnection() { throw new Error("database must not be reached"); } } }),
    (error) => error.code === "operation_run_revision_sensitive_field_forbidden"
  );
}

{
  const value = input();
  const rows = readbackRows(value, "33333333-3333-4333-8333-333333333333");
  rows.operation.revision_hash = "f".repeat(64);
  const fake = scriptedPool([
    { match: /^SELECT run_id,operation_key FROM operation_run_ownership/, result: [[{ run_id: value.run_id, operation_key: value.operation_key }]] },
    { match: /^SELECT id,operation_id,operation_key,version,revision_hash,status FROM operation_registry/, result: [[rows.operation]] }
  ]);
  await assert.rejects(
    persistOperationRunRevisionPin(value, { pool: fake.pool }),
    (error) => error.code === "operation_run_revision_contract_revision_conflict"
  );
  assert.equal(fake.lifecycle.committed, 0);
  assert.equal(fake.lifecycle.rolledBack, 1);
  assert.equal(fake.lifecycle.released, 1);
}

console.log("operation run revision pinning contract tests passed");
