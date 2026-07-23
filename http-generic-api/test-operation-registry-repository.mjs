import assert from "node:assert/strict";
import { normalizeOperationDefinition, operationRevisionHash } from "./operationRegistryContracts.js";
import { createOperationVersion, updateMutableOperationVersion } from "./operationRegistryRepository.js";

function definition(overrides = {}) {
  return {
    operation_key: "repo.change.preview",
    version: 1,
    display_name: "Repository Change Preview",
    description: "Build a bounded repository preview.",
    operation_class: "repository",
    scope_type: "admin",
    risk_level: "medium",
    execution_mode: "synchronous",
    input_schema_json: { type: "object", properties: { branch: { type: "string", minLength: 1 }, paths: { type: "array", items: { type: "string" }, maxItems: 100 } }, required: ["branch"], additionalProperties: false },
    output_schema_json: { type: "object", properties: { status: { type: "string", enum: ["ready", "blocked"] }, change_count: { type: "integer", minimum: 0 } }, required: ["status", "change_count"], additionalProperties: false },
    status: "draft",
    source_revision_hash: "a".repeat(64),
    compiler_version: "operation-registry-v1",
    metadata_json: { owner: "repository_automation", secrets_included: false },
    created_by: "platform_admin_service",
    steps: [
      { step_key: "context", step_order: 10, handler_key: "operation_context_get", capability_key: "repository_read", input_mapping_json: { branch: "$.branch" }, timeout_seconds: 30, status: "draft" },
      { step_key: "preview", step_order: 20, depends_on: ["context"], handler_key: "repo_change_preview", capability_key: "repository_read", timeout_seconds: 60, status: "draft" },
    ],
    ...overrides,
  };
}

function operationRow(value, hash, overrides = {}) {
  return { id: 7, operation_id: "11111111-1111-4111-8111-111111111111", operation_key: value.operation_key, version: value.version, display_name: value.display_name, description: value.description, operation_class: value.operation_class, scope_type: value.scope_type, risk_level: value.risk_level, execution_mode: value.execution_mode, input_schema_json: JSON.stringify(value.input_schema_json), output_schema_json: JSON.stringify(value.output_schema_json), status: value.status, revision_hash: hash, source_revision_hash: value.source_revision_hash, compiler_version: value.compiler_version, metadata_json: JSON.stringify(value.metadata_json), created_by: value.created_by, created_at: "2026-07-23T00:00:00.000Z", updated_at: "2026-07-23T00:00:00.000Z", activated_at: null, superseded_at: null, ...overrides };
}

function stepRows(value) {
  return value.steps.map((item, index) => ({ step_id: `22222222-2222-4222-8222-22222222222${index}`, step_key: item.step_key, step_order: item.step_order, depends_on_json: JSON.stringify(item.depends_on), handler_key: item.handler_key, capability_key: item.capability_key, input_mapping_json: item.input_mapping_json === null ? null : JSON.stringify(item.input_mapping_json), success_condition_json: item.success_condition_json === null ? null : JSON.stringify(item.success_condition_json), retry_policy_json: item.retry_policy_json === null ? null : JSON.stringify(item.retry_policy_json), failure_policy_json: item.failure_policy_json === null ? null : JSON.stringify(item.failure_policy_json), timeout_seconds: item.timeout_seconds, compensation_required: item.compensation_required ? 1 : 0, compensation_policy_key: item.compensation_policy_key, status: item.status, revision_hash: `${index + 1}`.repeat(64), metadata_json: item.metadata_json === null ? null : JSON.stringify(item.metadata_json), created_by: value.created_by, created_at: "2026-07-23T00:00:00.000Z", updated_at: "2026-07-23T00:00:00.000Z" }));
}

function fakePool(script) {
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
      if (next.inspect) next.inspect(params);
      return next.result;
    },
  };
  return { pool: { async getConnection() { return connection; } }, lifecycle, remaining: () => script.length };
}

const normalized = normalizeOperationDefinition(definition(), { mutableOnly: true });
const reordered = normalizeOperationDefinition(definition({ metadata_json: { secrets_included: false, owner: "repository_automation" } }), { mutableOnly: true });
assert.equal(operationRevisionHash(normalized), operationRevisionHash(reordered));
assert.throws(() => normalizeOperationDefinition({ ...definition(), unexpected: true }), (error) => error.code === "operation_registry_unknown_field");
assert.throws(() => normalizeOperationDefinition(definition({ input_schema_json: { type: "object", properties: { access_token: { type: "string" } }, required: [], additionalProperties: false } })), (error) => error.code === "operation_registry_secret_field_forbidden");
assert.throws(() => normalizeOperationDefinition(definition({ metadata_json: { provider_url: "https://example.invalid" } })), (error) => error.code === "operation_registry_transport_authority_forbidden");
assert.throws(() => normalizeOperationDefinition(definition({ steps: [{ step_key: "one", step_order: 1, depends_on: ["two"], handler_key: "handler.one" }, { step_key: "two", step_order: 2, depends_on: ["one"], handler_key: "handler.two" }] })), (error) => error.code === "operation_registry_dependency_cycle");

{
  const value = normalizeOperationDefinition(definition(), { mutableOnly: true });
  const hash = operationRevisionHash(value);
  const fake = fakePool([
    { match: /^SELECT id,operation_id,revision_hash,status FROM operation_registry/, result: [[]] },
    { match: /^INSERT INTO operation_registry/, result: [{ insertId: 7 }] },
    { match: /^INSERT INTO operation_step_registry/, result: [{}] },
    { match: /^INSERT INTO operation_step_registry/, result: [{}] },
    { match: /^SELECT id,operation_id,operation_key,version,display_name/, result: [[operationRow(value, hash)]] },
    { match: /^SELECT step_id,step_key,step_order/, result: [stepRows(value)] },
  ]);
  let counter = 0;
  const result = await createOperationVersion(definition(), { pool: fake.pool, uuid: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` });
  assert.equal(result.ok, true);
  assert.equal(result.revision_hash, hash);
  assert.equal(result.readback_complete, true);
  assert.equal(result.provider_calls_performed, false);
  assert.equal(fake.lifecycle.committed, 1);
  assert.equal(fake.lifecycle.rolledBack, 0);
  assert.equal(fake.lifecycle.released, 1);
  assert.equal(fake.remaining(), 0);
}

{
  const value = normalizeOperationDefinition(definition({ status: "active" }));
  const hash = operationRevisionHash(value);
  const fake = fakePool([
    { match: /^SELECT id,operation_id,operation_key,version,display_name/, result: [[operationRow(value, hash)]] },
    { match: /^SELECT step_id,step_key,step_order/, result: [stepRows(value)] },
  ]);
  await assert.rejects(updateMutableOperationVersion({ operation_key: value.operation_key, version: value.version, expected_revision_hash: hash, definition: definition() }, { pool: fake.pool }), (error) => error.code === "operation_registry_version_immutable");
  assert.equal(fake.lifecycle.committed, 0);
  assert.equal(fake.lifecycle.rolledBack, 1);
  assert.equal(fake.remaining(), 0);
}

{
  const value = normalizeOperationDefinition(definition(), { mutableOnly: true });
  const hash = operationRevisionHash(value);
  const fake = fakePool([
    { match: /^SELECT id,operation_id,operation_key,version,display_name/, result: [[operationRow(value, hash)]] },
    { match: /^SELECT step_id,step_key,step_order/, result: [stepRows(value)] },
  ]);
  await assert.rejects(updateMutableOperationVersion({ operation_key: value.operation_key, version: value.version, expected_revision_hash: "f".repeat(64), definition: definition() }, { pool: fake.pool }), (error) => error.code === "operation_registry_revision_conflict");
  assert.equal(fake.lifecycle.rolledBack, 1);
  assert.equal(fake.remaining(), 0);
}

console.log("operation registry repository contract tests passed");
