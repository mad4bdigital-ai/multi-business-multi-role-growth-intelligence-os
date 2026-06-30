import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CAPABILITY_GOVERNANCE_PERSIST_CONFIRM,
  persistDynamicCapabilityGovernanceCompilation,
} from "./dynamicCapabilityGovernancePersistence.js";

const preview = {
  compiler_version: "dynamic-capability-governance-compiler-v3",
  source_revision_hash: "a".repeat(64),
  filters: { limit: 2, gap_limit: 10, capability_key: null, source_table: null, after_key: null },
  page: { has_more: false, next_cursor: null, final_result_complete: true },
  counts: {
    source_rows: 2,
    manifest_count: 2,
    gap_count: 1,
    returned_gap_count: 1,
    blocked_manifest_count: 1,
    shadow_ready_manifest_count: 1,
  },
  manifests: [
    {
      capability_key: "platform.capability.read",
      effect_class: "read_only",
      risk_class: "A",
      authority_requirement_type: "invocation",
      status: "shadow_ready",
      rollout_mode: "shadow",
      source: { table: "tenant_platform_endpoint_tools", key: "platform_capability_read" },
      manifest_hash: "b".repeat(64),
      secrets_included: false,
    },
    {
      capability_key: "platform.alert.sync",
      effect_class: "internal_write",
      risk_class: "B",
      authority_requirement_type: "none",
      status: "blocked",
      rollout_mode: "shadow",
      source: { table: "admin_platform_endpoint_tools", key: "activation_operational_attention_sync_api" },
      manifest_hash: "c".repeat(64),
      secrets_included: false,
    },
  ],
  gaps: [
    {
      capability_key: "platform.alert.sync",
      gap_key: "READBACK_CONTRACT_REQUIRED",
      gap_severity: "medium",
      gap_description: "State-changing capability lacks a current readback contract.",
      source_table: "admin_platform_endpoint_tools",
      source_key: "activation_operational_attention_sync_api",
      blocks_dispatch: false,
    },
  ],
};

function createFakePool() {
  const state = {
    calls: [],
    began: false,
    committed: false,
    rolledBack: false,
    released: false,
    run: null,
    manifestInsertCount: 0,
    gapInsertCount: 0,
    uuidCounter: 0,
  };

  const connection = {
    async beginTransaction() { state.began = true; },
    async commit() { state.committed = true; },
    async rollback() { state.rolledBack = true; },
    release() { state.released = true; },
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ sql: normalized, params });
      if (normalized.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (normalized.startsWith("INSERT INTO platform_capability_compilation_runs")) {
        state.run = {
          run_id: params[0],
          idempotency_key: params[1],
          compiler_version: params[2],
          status: "running",
          source_revision_hash: params[3],
          input_hash: params[4],
          output_hash: null,
          source_count: params[6],
          compiled_manifest_count: params[7],
          persisted_manifest_count: 0,
          reused_manifest_count: 0,
          gap_count: params[8],
          blocked_manifest_count: params[9],
          shadow_ready_manifest_count: params[10],
          capability_envelope_id: params[12],
          secrets_included: 0,
        };
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes("FROM platform_capability_compiled_manifests") && normalized.includes("source_revision_hash=?")) return [[]];
      if (normalized.includes("FROM platform_capability_compiled_manifests") && normalized.includes("ORDER BY manifest_version")) return [[]];
      if (normalized.startsWith("UPDATE platform_capability_compiled_manifests")) return [{ affectedRows: 0 }];
      if (normalized.startsWith("INSERT INTO platform_capability_compiled_manifests")) {
        state.manifestInsertCount += 1;
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("INSERT INTO platform_capability_manifest_source_links")) return [{ affectedRows: 1 }];
      if (normalized.startsWith("INSERT INTO platform_capability_governance_gap_snapshots")) {
        state.gapInsertCount += 1;
        return [{ affectedRows: 1 }];
      }
      if (normalized.startsWith("UPDATE platform_capability_compilation_runs")) {
        state.run = {
          ...state.run,
          status: "complete",
          output_hash: params[0],
          persisted_manifest_count: params[1],
          reused_manifest_count: params[2],
          completed_at: "2026-06-30T00:00:00.000Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (normalized.includes("FROM platform_capability_compilation_runs") && normalized.includes("WHERE run_id=?")) return [[state.run]];
      if (normalized.includes("COUNT(*) AS created_manifest_count")) {
        return [[{ created_manifest_count: state.manifestInsertCount, current_created_manifest_count: state.manifestInsertCount }]];
      }
      if (normalized.includes("COUNT(*) AS persisted_gap_count")) {
        return [[{ persisted_gap_count: state.gapInsertCount, blocking_gap_count: 0 }]];
      }
      if (normalized.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };

  const pool = {
    state,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ sql: normalized, params });
      if (normalized.includes("FROM platform_capability_compilation_runs") && normalized.includes("idempotency_key=?")) return [[]];
      throw new Error(`Unexpected pool SQL: ${normalized}`);
    },
    async getConnection() { return connection; },
  };
  return pool;
}

let uuidCounter = 0;
const pool = createFakePool();
const result = await persistDynamicCapabilityGovernanceCompilation({
  idempotency_key: "persist-test-001",
  expected_source_revision_hash: preview.source_revision_hash,
  confirm: CAPABILITY_GOVERNANCE_PERSIST_CONFIRM,
  capability_envelope_id: "envelope-001",
  requested_by: "test",
}, {
  pool,
  previewBuilder: async () => preview,
  uuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`,
});

assert.equal(result.ok, true);
assert.equal(result.replayed, false);
assert.equal(result.readback_complete, true);
assert.equal(result.counts.compiled_manifest_count, 2);
assert.equal(result.counts.persisted_manifest_count, 2);
assert.equal(result.counts.reused_manifest_count, 0);
assert.equal(result.counts.persisted_gap_count, 1);
assert.equal(result.provider_calls_performed, false);
assert.equal(result.tenant_authority_changed, false);
assert.equal(result.secrets_included, false);
assert.equal(pool.state.began, true);
assert.equal(pool.state.committed, true);
assert.equal(pool.state.rolledBack, false);
assert.equal(pool.state.released, true);
assert.equal(pool.state.manifestInsertCount, 2);
assert.equal(pool.state.gapInsertCount, 1);

await assert.rejects(
  () => persistDynamicCapabilityGovernanceCompilation({
    idempotency_key: "persist-test-002",
    expected_source_revision_hash: preview.source_revision_hash,
    confirm: "WRONG",
    capability_envelope_id: "envelope-002",
  }, { pool: createFakePool(), previewBuilder: async () => preview }),
  (error) => error.code === "capability_governance_typed_confirmation_required"
);

await assert.rejects(
  () => persistDynamicCapabilityGovernanceCompilation({
    idempotency_key: "persist-test-003",
    expected_source_revision_hash: "d".repeat(64),
    confirm: CAPABILITY_GOVERNANCE_PERSIST_CONFIRM,
    capability_envelope_id: "envelope-003",
  }, { pool: createFakePool(), previewBuilder: async () => preview }),
  (error) => error.code === "capability_governance_source_revision_mismatch"
);

await assert.rejects(
  () => persistDynamicCapabilityGovernanceCompilation({
    idempotency_key: "persist-test-004",
    expected_source_revision_hash: preview.source_revision_hash,
    confirm: CAPABILITY_GOVERNANCE_PERSIST_CONFIRM,
    capability_envelope_id: "envelope-004",
    gap_limit: 1,
  }, {
    pool: createFakePool(),
    previewBuilder: async () => ({
      ...preview,
      counts: { ...preview.counts, gap_count: 2, returned_gap_count: 1 },
    }),
  }),
  (error) => error.code === "capability_governance_gap_snapshot_truncated"
);

const conflictPool = {
  async query(sql) {
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    assert.match(normalized, /FROM platform_capability_compilation_runs/);
    return [[{
      run_id: "existing-run",
      idempotency_key: "persist-test-005",
      compiler_version: preview.compiler_version,
      status: "complete",
      source_revision_hash: preview.source_revision_hash,
      input_hash: "e".repeat(64),
      output_hash: "f".repeat(64),
      source_count: 2,
      compiled_manifest_count: 2,
      persisted_manifest_count: 2,
      reused_manifest_count: 0,
      gap_count: 1,
      blocked_manifest_count: 1,
      shadow_ready_manifest_count: 1,
      capability_envelope_id: "different-envelope",
      secrets_included: 0,
    }]];
  },
};
await assert.rejects(
  () => persistDynamicCapabilityGovernanceCompilation({
    idempotency_key: "persist-test-005",
    expected_source_revision_hash: preview.source_revision_hash,
    confirm: CAPABILITY_GOVERNANCE_PERSIST_CONFIRM,
    capability_envelope_id: "envelope-005",
  }, { pool: conflictPool, previewBuilder: async () => preview }),
  (error) => error.code === "capability_governance_idempotency_conflict"
);

const migrationPath = new URL("./migrations/20260630_dynamic_capability_governance_persistence.sql", import.meta.url);
const migration = fs.readFileSync(migrationPath, "utf8");
for (const table of [
  "platform_capability_compilation_runs",
  "platform_capability_compiled_manifests",
  "platform_capability_manifest_source_links",
  "platform_capability_governance_gap_snapshots",
]) {
  assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS \`${table}\``), true, table);
}
assert.equal(migration.includes("current_capability_key"), true);
assert.equal(migration.includes("uq_pccm_current_capability"), true);
assert.equal(migration.includes("canonical_capability_authority','platform_plugin_capabilities'"), true);
assert.equal(migration.includes("no_provider_call"), true);
assert.equal(migration.includes("secrets_included=false"), true);

console.log("dynamic capability governance persistence tests passed");
