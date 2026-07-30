import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { inspectGovernedMigrationExecution } from "./governedMigrationExecutionTool.js";
import {
  CONNECTION_OWNERSHIP_MIGRATION_EXPECTED_STATEMENT_COUNT,
  CONNECTION_OWNERSHIP_MIGRATION_FILE,
  ConnectionOwnershipMigrationPreflightContract,
  buildConnectionOwnershipMigrationDryRunInput,
  buildConnectionOwnershipMigrationReadbackInput,
  classifyConnectionOwnershipMigrationReadback,
  inspectConnectionOwnershipMigrationArtifact,
} from "./contextKernel/migration/connectionOwnershipMigrationPreflight.js";

const inspection = await inspectConnectionOwnershipMigrationArtifact();
assert.equal(inspection.ok, true);
assert.equal(inspection.migration, CONNECTION_OWNERSHIP_MIGRATION_FILE);
assert.equal(
  inspection.statement_count,
  CONNECTION_OWNERSHIP_MIGRATION_EXPECTED_STATEMENT_COUNT,
);
assert.match(inspection.migration_checksum_sha256, /^[0-9a-f]{64}$/);
assert.deepEqual(inspection.statement_identities, [
  "ALTER TABLE workspace_registry",
  "CREATE TABLE connection_ownership_scopes",
  "CREATE TABLE provider_authorization_states",
  "CREATE OR REPLACE VIEW v_context_kernel_connection_ownership_compatibility",
]);
assert.equal(
  inspection.required_confirmation,
  "APPLY_20260730_CONTEXT_KERNEL_CONNECTION_OWNERSHIP_PERSISTENCE",
);
assert.equal(
  inspection.resource_uri,
  "db-migration://growth_intelligence_platform/20260730_context_kernel_connection_ownership_persistence.sql",
);
assert.equal(inspection.additive_only, true);
assert.equal(inspection.inferred_backfill_present, false);
assert.equal(inspection.destructive_sql_present, false);
assert.equal(inspection.mutation_requested, false);
assert.equal(inspection.apply_permitted, false);
assert.equal(inspection.authorization_status, "pending_separate_authorization");
assert.equal(inspection.database_connection_opened, false);
assert.equal(inspection.provider_call_executed, false);
assert.equal(inspection.external_write_executed, false);
assert.equal(inspection.secrets_included, false);

const dryRunInput = buildConnectionOwnershipMigrationDryRunInput(inspection);
assert.deepEqual(dryRunInput, {
  migration: CONNECTION_OWNERSHIP_MIGRATION_FILE,
  mode: "dry_run",
  expected_checksum_sha256: inspection.migration_checksum_sha256,
  expected_statement_count: inspection.statement_count,
});
const governedInspection = await inspectGovernedMigrationExecution(dryRunInput);
assert.equal(governedInspection.mode, "dry_run");
assert.equal(governedInspection.migration_checksum_sha256, inspection.migration_checksum_sha256);
assert.equal(governedInspection.statement_count, inspection.statement_count);
assert.equal(governedInspection.deployment, null);
assert.equal(governedInspection.required_envelope, null);
assert.equal(governedInspection.secrets_included, false);

const readbackInput = buildConnectionOwnershipMigrationReadbackInput(inspection);
assert.equal(readbackInput.expected_statement_count, 4);
assert.equal(readbackInput.expected_checksum_sha256, inspection.migration_checksum_sha256);
assert.ok(readbackInput.expected_tables.includes("connection_ownership_scopes"));
assert.ok(readbackInput.expected_tables.includes("provider_authorization_states"));
assert.ok(
  readbackInput.expected_tables.includes(
    "v_context_kernel_connection_ownership_compatibility",
  ),
);
assert.ok(
  readbackInput.expected_columns.some(
    (entry) => entry.table === "workspace_registry"
      && entry.column === "workspace_ownership_type",
  ),
);
assert.ok(
  readbackInput.expected_indexes.some(
    (entry) => entry.table === "provider_authorization_states"
      && entry.index === "idx_provider_authorization_claim",
  ),
);

assert.equal(
  classifyConnectionOwnershipMigrationReadback({
    ok: true,
    ledger: { found: true },
    expectations: {
      missing: { tables: [], columns: [], indexes: [], rule_conditions: [] },
    },
  }),
  "ready",
);
assert.equal(
  classifyConnectionOwnershipMigrationReadback({
    ok: false,
    ledger: { found: false },
    expectations: {
      missing: {
        tables: [
          "connection_ownership_scopes",
          "provider_authorization_states",
          "v_context_kernel_connection_ownership_compatibility",
        ],
        columns: [
          { table: "workspace_registry", column: "workspace_ownership_type" },
          { table: "workspace_registry", column: "owner_user_id" },
          { table: "workspace_registry", column: "ownership_revision" },
        ],
        indexes: [],
        rule_conditions: [],
      },
    },
  }),
  "absent",
);
assert.equal(
  classifyConnectionOwnershipMigrationReadback({
    ok: false,
    ledger: { found: false },
    expectations: {
      missing: {
        tables: ["provider_authorization_states"],
        columns: [],
        indexes: [],
        rule_conditions: [],
      },
    },
  }),
  "partial",
);

assert.equal(ConnectionOwnershipMigrationPreflightContract.execution_status, "not_authorized");
assert.equal(ConnectionOwnershipMigrationPreflightContract.migration_applied, false);
assert.equal(ConnectionOwnershipMigrationPreflightContract.same_cycle_readback_complete, false);
assert.equal(ConnectionOwnershipMigrationPreflightContract.runtime_consumers_enabled, false);
assert.equal(
  ConnectionOwnershipMigrationPreflightContract.rollback_strategy,
  "disable_consumers_and_retain_additive_schema",
);

const moduleSource = readFileSync(
  "contextKernel/migration/connectionOwnershipMigrationPreflight.js",
  "utf8",
);
assert.doesNotMatch(moduleSource, /getPool|createConnection|beginTransaction|\.query\s*\(/);
assert.match(moduleSource, /pending_separate_authorization/);
assert.match(moduleSource, /mutation_requested:\s*false/);
assert.match(moduleSource, /apply_permitted:\s*false/);

console.log(JSON.stringify({
  check: "connection_ownership_migration_preflight",
  migration: inspection.migration,
  migration_checksum_sha256: inspection.migration_checksum_sha256,
  statement_count: inspection.statement_count,
  mutation_requested: false,
  migration_applied: false,
  secrets_included: false,
}));
