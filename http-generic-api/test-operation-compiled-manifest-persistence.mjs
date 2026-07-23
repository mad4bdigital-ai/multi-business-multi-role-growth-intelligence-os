import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stableOperationHash } from "./operationRegistryContracts.js";
import { persistOperationCompiledManifest } from "./operationCompiledManifestRepository.js";

const migration = readFileSync(
  new URL("./migrations/20260723_operation_compiled_manifest_persistence.sql", import.meta.url),
  "utf8"
);
const activationSurface = JSON.parse(
  readFileSync(new URL("./activation-surfaces/operation_compiled_manifests.json", import.meta.url), "utf8")
);

for (const table of ["operation_compiled_manifests", "operation_compiled_manifest_current"]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
}
assert.match(migration, /CREATE OR REPLACE VIEW v_operation_compiled_manifest_readback AS/);
assert.match(migration, /UNIQUE KEY uq_operation_compiled_manifest_current_scope \(operation_registry_id, scope_fingerprint\)/);
assert.match(migration, /FOREIGN KEY \(manifest_id, operation_registry_id, scope_fingerprint\)/);
assert.match(migration, /certification_status ENUM\('uncertified', 'certified', 'expired', 'revoked'\)/);
assert.match(migration, /rollout_mode ENUM\('disabled', 'shadow', 'canary', 'active', 'fallback'\)/);
assert.match(migration, /validation_status ENUM\('valid', 'invalid', 'blocked', 'superseded', 'revoked'\)/);
assert.match(migration, /0 AS secrets_included/);
const sqlWithoutComments = migration.replace(/--.*$/gm, "");
assert.doesNotMatch(sqlWithoutComments, /(?:^|;)\s*(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w|INSERT\s+INTO|RENAME\s+TABLE)\b/im);

assert.equal(activationSurface.source_table, "v_operation_compiled_manifest_readback");
assert.deepEqual(activationSurface.covered_source_tables, ["operation_compiled_manifests", "operation_compiled_manifest_current"]);
assert.equal(activationSurface.include_for_admin, true);
assert.equal(activationSurface.include_for_tenant, false);
assert.ok(!activationSurface.result_columns.includes("manifest_json"));
assert.ok(!activationSurface.result_columns.some((column) => /credential|secret|updated_by|created_by/i.test(column)));

function manifest() {
  const core = {
    schema_version: "operation-binding-manifest-v1",
    compiler_version: "operation-binding-compiler-v1",
    compiled_at: "2026-07-23T04:00:00.000Z",
    compile_mode: "shadow",
    operation: {
      operation_key: "repo.change.preview",
      version: 1,
      revision_hash: "a".repeat(64),
      operation_class: "repository",
      risk_level: "medium"
    },
    scope_fingerprint: "b".repeat(64),
    source_revision_hash: "c".repeat(64),
    selected_binding: {
      binding_id: "11111111-1111-4111-8111-111111111111",
      binding_key: "binding.resource.github",
      binding_scope_type: "resource",
      scope_ref_hash: "d".repeat(64),
      provider_family: "github",
      adapter_key: "repository.preview.adapter",
      runtime_key: "managed_api_runtime",
      capability_key: "repository_read",
      dispatch_binding_key: "dispatch.repository.preview",
      endpoint_export_key: "export.repository.preview",
      priority: 100,
      fallback_rank: 0,
      requires_approval: false,
      requires_readback: true,
      revision_hash: "e".repeat(64),
      rank: [4, 2, 1, 100, 0, 0.8],
      score: 0.8
    },
    fallback_bindings: [],
    candidate_evidence: [],
    resolution_summary: {
      candidate_count: 1,
      eligible_count: 1,
      excluded_count: 0,
      ambiguity_rejected: false,
      fail_closed: true
    },
    scoring_policy: { weights: { quality: 1 } },
    safety: {
      provider_calls_performed: false,
      credential_payloads_read: false,
      external_writes_performed: false,
      runtime_activation_changed: false,
      secrets_included: false
    }
  };
  return { ...core, manifest_hash: stableOperationHash(core) };
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

{
  const compiledManifest = manifest();
  const canonicalJson = JSON.stringify(compiledManifest);
  const fake = fakePool([
    {
      match: /^SELECT id,operation_id,operation_key,version,revision_hash,status FROM operation_registry/,
      result: [[{ id: 7, operation_id: "op-1", operation_key: "repo.change.preview", version: 1, revision_hash: "a".repeat(64), status: "shadow" }]]
    },
    { match: /^SELECT manifest_id,manifest_version,manifest_json,validation_status/, result: [[]] },
    { match: /^SELECT COALESCE\(MAX\(manifest_version\),0\)/, result: [[{ max_manifest_version: 0 }]] },
    { match: /^INSERT INTO operation_compiled_manifests/, result: [{ affectedRows: 1 }] },
    { match: /^SELECT id,manifest_id,pointer_revision FROM operation_compiled_manifest_current/, result: [[]] },
    { match: /^INSERT INTO operation_compiled_manifest_current/, result: [{ affectedRows: 1 }] },
    {
      match: /^SELECT m.id,m.manifest_id,m.operation_registry_id/,
      result: [[{
        id: 9,
        manifest_id: "22222222-2222-4222-8222-222222222222",
        operation_registry_id: 7,
        operation_id: "op-1",
        operation_key: "repo.change.preview",
        operation_version: 1,
        manifest_version: 1,
        scope_fingerprint: "b".repeat(64),
        source_revision_hash: "c".repeat(64),
        manifest_hash: compiledManifest.manifest_hash,
        compiler_version: "operation-binding-compiler-v1",
        validation_status: "valid",
        rollout_mode: "shadow",
        certification_status: "uncertified",
        manifest_json: canonicalJson,
        expires_at: null,
        revoked_at: null,
        created_by: "platform_admin_service",
        created_at: "2026-07-23T04:00:00.000Z",
        pointer_revision: 1,
        is_current: 1
      }]]
    }
  ]);
  const result = await persistOperationCompiledManifest({
    manifest: compiledManifest,
    validation_status: "valid",
    rollout_mode: "shadow",
    certification_status: "uncertified",
    make_current: true,
    created_by: "platform_admin_service"
  }, {
    pool: fake.pool,
    uuid: () => "22222222-2222-4222-8222-222222222222"
  });
  assert.equal(result.ok, true);
  assert.equal(result.inserted, true);
  assert.equal(result.current_pointer_changed, true);
  assert.equal(result.record.is_current, true);
  assert.equal(result.runtime_activation_changed, false);
  assert.equal(result.credential_payloads_read, false);
  assert.equal(fake.lifecycle.committed, 1);
  assert.equal(fake.lifecycle.rolledBack, 0);
  assert.equal(fake.lifecycle.released, 1);
  assert.equal(fake.remaining(), 0);
}

{
  const compiledManifest = manifest();
  const invalid = { ...compiledManifest, manifest_hash: "f".repeat(64) };
  await assert.rejects(
    persistOperationCompiledManifest({ manifest: invalid, make_current: false, created_by: "platform_admin_service" }, {
      pool: { async getConnection() { throw new Error("database must not be reached"); } }
    }),
    (error) => error.code === "operation_manifest_hash_mismatch"
  );
}

{
  const compiledManifest = manifest();
  const fake = fakePool([
    {
      match: /^SELECT id,operation_id,operation_key,version,revision_hash,status FROM operation_registry/,
      result: [[{ id: 7, operation_id: "op-1", operation_key: "repo.change.preview", version: 1, revision_hash: "f".repeat(64), status: "shadow" }]]
    }
  ]);
  await assert.rejects(
    persistOperationCompiledManifest({ manifest: compiledManifest, make_current: false, created_by: "platform_admin_service" }, { pool: fake.pool }),
    (error) => error.code === "operation_manifest_operation_revision_conflict"
  );
  assert.equal(fake.lifecycle.committed, 0);
  assert.equal(fake.lifecycle.rolledBack, 1);
  assert.equal(fake.lifecycle.released, 1);
  assert.equal(fake.remaining(), 0);
}

console.log("operation compiled manifest persistence contract tests passed");
