import assert from "node:assert/strict";

import {
  AuthorityLiveCensusAdapterError,
  _testingAuthorityLiveCensusAdapter,
  adaptAuthorityLiveCensusObservation,
} from "./authorityLiveCensusAdapter.js";

function observation(overrides = {}) {
  const payload = {
    contract: "mad4b.ueacp.live-authority-catalog-observation.v1",
    status: "observed_unclassified",
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    observed_ref: "1234567890abcdef1234567890abcdef12345678",
    environment: "production_runtime",
    mode: "read_only_authority_catalog_census",
    started_at: "2030-01-01T00:00:00Z",
    completed_at: "2030-01-01T00:03:00Z",
    database_server: {
      schema_name: "platform",
      version: "11.4.2-MariaDB",
      version_comment: "MariaDB Server",
      observed_at: "2030-01-01T00:01:00Z",
      readback_at: "2030-01-01T00:03:00Z",
    },
    summary: {
      object_count: 3,
      base_table_count: 2,
      view_count: 1,
      column_count: 4,
      index_column_count: 2,
      foreign_key_count: 1,
      view_dependency_count: 1,
      explicit_revision_table_count: 1,
      temporal_only_table_count: 1,
      absent_revision_table_count: 0,
    },
    objects: [
      { TABLE_SCHEMA: "platform", TABLE_NAME: "platform_semantic_capabilities", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_ROWS: 10 },
      { TABLE_SCHEMA: "platform", TABLE_NAME: "resource_authority_bindings", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_ROWS: 20 },
      { TABLE_SCHEMA: "platform", TABLE_NAME: "v_effective_capabilities", TABLE_TYPE: "VIEW", ENGINE: null, TABLE_ROWS: null },
    ],
    columns: [
      { TABLE_NAME: "platform_semantic_capabilities", COLUMN_NAME: "capability_key", ORDINAL_POSITION: 1, DATA_TYPE: "varchar", COLUMN_TYPE: "varchar(191)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null, COLUMN_KEY: "PRI", EXTRA: "", COLLATION_NAME: "utf8mb4_unicode_ci" },
      { TABLE_NAME: "platform_semantic_capabilities", COLUMN_NAME: "revision", ORDINAL_POSITION: 2, DATA_TYPE: "bigint", COLUMN_TYPE: "bigint(20)", IS_NULLABLE: "NO", COLUMN_DEFAULT: "0", COLUMN_KEY: "", EXTRA: "", COLLATION_NAME: null },
      { TABLE_NAME: "resource_authority_bindings", COLUMN_NAME: "binding_key", ORDINAL_POSITION: 1, DATA_TYPE: "varchar", COLUMN_TYPE: "varchar(191)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null, COLUMN_KEY: "PRI", EXTRA: "", COLLATION_NAME: "utf8mb4_unicode_ci" },
      { TABLE_NAME: "resource_authority_bindings", COLUMN_NAME: "updated_at", ORDINAL_POSITION: 2, DATA_TYPE: "datetime", COLUMN_TYPE: "datetime(6)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null, COLUMN_KEY: "", EXTRA: "", COLLATION_NAME: null },
    ],
    indexes: [
      { TABLE_NAME: "platform_semantic_capabilities", INDEX_NAME: "PRIMARY", NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: "capability_key", SUB_PART: null, INDEX_TYPE: "BTREE" },
      { TABLE_NAME: "resource_authority_bindings", INDEX_NAME: "PRIMARY", NON_UNIQUE: 0, SEQ_IN_INDEX: 1, COLUMN_NAME: "binding_key", SUB_PART: null, INDEX_TYPE: "BTREE" },
    ],
    foreign_keys: [
      { CONSTRAINT_NAME: "fk_binding_capability", TABLE_NAME: "resource_authority_bindings", COLUMN_NAME: "binding_key", ORDINAL_POSITION: 1, REFERENCED_TABLE_SCHEMA: "platform", REFERENCED_TABLE_NAME: "platform_semantic_capabilities", REFERENCED_COLUMN_NAME: "capability_key" },
    ],
    views: [
      { TABLE_NAME: "v_effective_capabilities", CHECK_OPTION: "NONE", IS_UPDATABLE: "NO", SECURITY_TYPE: "DEFINER", definition_sha256: "a".repeat(64) },
    ],
    view_dependencies: [
      { VIEW_SCHEMA: "platform", VIEW_NAME: "v_effective_capabilities", TABLE_SCHEMA: "platform", TABLE_NAME: "platform_semantic_capabilities" },
    ],
    revision_support: [
      { object_name: "platform_semantic_capabilities", support: "explicit_revision", explicit_revision_columns: ["revision"], temporal_freshness_columns: [] },
      { object_name: "resource_authority_bindings", support: "temporal_freshness_only", explicit_revision_columns: [], temporal_freshness_columns: ["updated_at"] },
    ],
    same_cycle_readback: {
      verified: true,
      schema_name: "platform",
      object_count: 3,
      column_count: 4,
      view_count: 1,
      readback_at: "2030-01-01T00:03:00Z",
    },
    queries_executed: [
      "database_identity",
      "schema_objects",
      "schema_columns",
      "schema_indexes",
      "schema_foreign_keys",
      "schema_views",
      "view_dependencies",
      "same_cycle_readback",
    ],
    closure_state: {
      t002_complete: false,
      ready_for_ownership_classification: true,
      t021_authorized: false,
      migration_apply_authorized: false,
    },
    read_only: true,
    applies_sql: false,
    runtime_authority_changed: false,
    database_mutation_executed: false,
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
    ...overrides,
  };
  payload.observation_sha256 = _testingAuthorityLiveCensusAdapter.sha256(payload);
  return payload;
}

const adapted = adaptAuthorityLiveCensusObservation(observation());
assert.equal(adapted.ok, true);
assert.equal(adapted.schema_name, "platform");
assert.equal(adapted.objects.length, 3);
assert.equal(adapted.columns.length, 4);
assert.equal(adapted.indexes.length, 2);
assert.equal(adapted.foreign_keys.length, 1);
assert.equal(adapted.views.length, 1);
assert.equal(adapted.view_dependencies.length, 1);
assert.equal(adapted.objects.find((item) => item.object_name === "platform_semantic_capabilities").ownership_classification, "authority_source_candidate");
assert.equal(adapted.objects.find((item) => item.object_name === "v_effective_capabilities").ownership_classification, "derived_projection_candidate");
assert.equal(_testingAuthorityLiveCensusAdapter.classifyObject("system_tool_catalog", "BASE TABLE"), "unclassified");
assert.equal(_testingAuthorityLiveCensusAdapter.classifyObject("authority_decision_logs", "BASE TABLE"), "evidence_ledger_candidate");
assert.equal(_testingAuthorityLiveCensusAdapter.classifyObject("tenant_memberships", "BASE TABLE"), "authority_source_candidate");
assert.equal(adapted.revision_support[0].requires_authoritative_owner_review, true);
assert.equal(adapted.same_cycle_readback.verified, true);
assert.equal(adapted.closure_state.t002_complete, false);
assert.equal(adapted.closure_state.t021_authorized, false);
assert.equal(adapted.closure_state.migration_apply_authorized, false);
assert.equal(adapted.read_only, true);
assert.equal(adapted.applies_sql, false);
assert.equal(adapted.database_mutation_executed, false);
assert.equal(adapted.provider_calls, false);
assert.equal(adapted.credential_payload_read, false);
assert.equal(adapted.external_writes, false);
assert.equal(adapted.secrets_included, false);
assert.equal(Object.isFrozen(adapted), true);

assert.throws(
  () => adaptAuthorityLiveCensusObservation({ ...observation(), status: "tampered" }),
  (error) => error instanceof AuthorityLiveCensusAdapterError && error.code === "authority_live_census_unsafe_observation",
);

const stale = observation();
stale.objects = stale.objects.slice(0, 2);
assert.throws(
  () => adaptAuthorityLiveCensusObservation(stale),
  (error) => error instanceof AuthorityLiveCensusAdapterError && error.code === "authority_live_census_stale_hash",
);

const countMismatch = observation();
countMismatch.summary = { ...countMismatch.summary, object_count: 4 };
countMismatch.observation_sha256 = _testingAuthorityLiveCensusAdapter.sha256({ ...countMismatch, observation_sha256: undefined });
assert.throws(
  () => adaptAuthorityLiveCensusObservation(countMismatch),
  (error) => error instanceof AuthorityLiveCensusAdapterError
    && ["authority_live_census_stale_hash", "authority_live_census_count_mismatch"].includes(error.code),
);

const secretBearing = observation({ access_token: "forbidden" });
assert.throws(
  () => adaptAuthorityLiveCensusObservation(secretBearing),
  (error) => error instanceof AuthorityLiveCensusAdapterError && error.code === "authority_live_census_sensitive_value_forbidden",
);

const readbackMismatch = observation();
readbackMismatch.same_cycle_readback = { ...readbackMismatch.same_cycle_readback, object_count: 2 };
const { observation_sha256: _ignored, ...unsignedReadbackMismatch } = readbackMismatch;
readbackMismatch.observation_sha256 = _testingAuthorityLiveCensusAdapter.sha256(unsignedReadbackMismatch);
assert.throws(
  () => adaptAuthorityLiveCensusObservation(readbackMismatch),
  (error) => error instanceof AuthorityLiveCensusAdapterError && error.code === "authority_live_census_readback_count_mismatch",
);

console.log("authority live census adapter tests passed");