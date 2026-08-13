export const TRACK_B_MIGRATION_READINESS_CONTRACT = "mad4b.track-b-migration-readiness.v1";

export const TRACK_B_MIGRATION_PINS = Object.freeze({
  connection_ownership: Object.freeze({
    feature_key: "012-unified-admin-tenant-context-kernel",
    migration_file: "20260730_context_kernel_connection_ownership_persistence.sql",
    source_merge_sha: "a9c3aa67e4ed2d846fc9a0697fa95d5c5fd35902",
    checksum_sha256: "8689a9440be9224e1b19ee1d88c983feb10f4056cc7a83d59790e9230ed28faf",
    statement_count: 4,
    typed_confirmation: "APPLY_20260730_CONTEXT_KERNEL_CONNECTION_OWNERSHIP_PERSISTENCE",
    resource_uri: "db-migration://growth_intelligence_platform/20260730_context_kernel_connection_ownership_persistence.sql",
    expected_objects: Object.freeze([
      "workspace_registry.workspace_ownership_type",
      "workspace_registry.owner_user_id",
      "workspace_registry.ownership_revision",
      "connection_ownership_scopes",
      "provider_authorization_states",
      "v_context_kernel_connection_ownership_compatibility",
    ]),
  }),
  tenant_managed_execution_1043: Object.freeze({
    feature_key: "017-tenant-managed-execution-lifecycle",
    migration_file: "1043_sprint69_tenant_managed_execution_lifecycle.sql",
    source_pr: 4845,
    source_merge_sha: "a1c1f3d4f4b36a3a5764d898194818e3e9ea1ce3",
    git_blob_sha: "7f3e0152bcdfba36a659ff4a1df8e30d82024c8c",
    checksum_sha256: "a11dff751fca4df19a6acfc188ca7310d8e1a90aa5c3f06fe0c3efeb1213a2a9",
    statement_count: 4,
    expected_objects: Object.freeze([
      "managed_execution_bindings",
      "managed_execution_step_requests",
      "managed_execution_events",
      "v_managed_execution_lifecycle_readiness",
    ]),
  }),
});

function text(value) { return String(value ?? "").trim(); }
function same(a, b) { return text(a).toLowerCase() === text(b).toLowerCase() && text(a) !== ""; }

function validatePin(observed = {}, expected = {}) {
  const blockers = [];
  if (!same(observed.migration_file, expected.migration_file)) blockers.push("MIGRATION_FILENAME_MISMATCH");
  if (!same(observed.checksum_sha256, expected.checksum_sha256)) blockers.push("MIGRATION_CHECKSUM_MISMATCH");
  if (Number(observed.statement_count) !== Number(expected.statement_count)) blockers.push("MIGRATION_STATEMENT_COUNT_MISMATCH");
  if (expected.git_blob_sha && !same(observed.git_blob_sha, expected.git_blob_sha)) blockers.push("MIGRATION_GIT_BLOB_MISMATCH");
  if (expected.source_merge_sha && observed.source_merge_sha && !same(observed.source_merge_sha, expected.source_merge_sha)) blockers.push("MIGRATION_SOURCE_MERGE_MISMATCH");
  return blockers;
}

function migrationEntry(key, expected, observed = {}) {
  const blockers = validatePin(observed, expected);
  return Object.freeze({
    migration_key: key,
    feature_key: expected.feature_key,
    migration_file: expected.migration_file,
    source_pr: expected.source_pr ?? null,
    source_merge_sha: expected.source_merge_sha,
    git_blob_sha: expected.git_blob_sha ?? null,
    checksum_sha256: expected.checksum_sha256,
    statement_count: expected.statement_count,
    typed_confirmation: expected.typed_confirmation ?? null,
    resource_uri: expected.resource_uri ?? null,
    expected_objects: expected.expected_objects,
    repository_preflight_status: blockers.length ? "blocked" : "pass",
    blockers: Object.freeze(blockers),
    authorization_status: "pending_separate_authorization",
    ledger_contract: Object.freeze({
      exact_filename_required: true,
      exact_checksum_required: true,
      exact_statement_count_required: true,
      source_merge_binding_required: true,
      readback_before_retry_required: true,
    }),
    same_cycle_readback_contract: Object.freeze({
      migration_ledger_required: true,
      expected_objects_required: true,
      authoritative_schema_source_required: true,
      checksum_and_statement_count_must_match: true,
      unknown_outcome_requires_readback: true,
    }),
    live_dry_run_executed: false,
    apply_authorized: false,
    apply_sent: false,
    migration_applied: false,
    database_mutated: false,
    same_cycle_readback_complete: false,
    runtime_consumers_enabled: false,
    provider_called: false,
    credential_payload_read: false,
    production_mutated: false,
    secrets_included: false,
  });
}

export function buildTrackBMigrationReadinessManifest({
  connection_ownership = TRACK_B_MIGRATION_PINS.connection_ownership,
  tenant_managed_execution_1043 = TRACK_B_MIGRATION_PINS.tenant_managed_execution_1043,
} = {}) {
  const entries = Object.freeze([
    migrationEntry("context_connection_ownership", TRACK_B_MIGRATION_PINS.connection_ownership, connection_ownership),
    migrationEntry("tenant_managed_execution_1043", TRACK_B_MIGRATION_PINS.tenant_managed_execution_1043, tenant_managed_execution_1043),
  ]);
  return Object.freeze({
    contract: TRACK_B_MIGRATION_READINESS_CONTRACT,
    entries,
    repository_preflight_pass: entries.every((entry) => entry.repository_preflight_status === "pass"),
    independent_apply_authorization_required: true,
    migration_applied: false,
    database_mutated: false,
    provider_called: false,
    runtime_consumers_enabled: false,
    production_mutated: false,
    secrets_included: false,
  });
}
