import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";

// Source-only, read-only decision contract. Never infers physical absence from
// information_schema rows returned by an unprivileged application identity.
// Does not plan or execute SQL, grant authority, or mutate a Production target.
export const DATABASE_SCHEMA_RECOVERY_TRIAGE_CONTRACT = "mad4b.database-schema-recovery-triage.v1";
const ROLES = Object.freeze(["runtime", "governance", "runtime_persistence"]);
const SHA_RE = /^[0-9a-f]{40}$/u;
const OBJECT_TYPES = Object.freeze(["tables", "views", "triggers", "routines", "events"]);
const schemaBaseline = readRuntimeBootstrapContract().baseline_bundle;
const REQUIRED_SOURCE_TABLES = Object.freeze({
  runtime: Object.freeze([...schemaBaseline.required_runtime_tables]),
  governance: Object.freeze([...schemaBaseline.required_governance_tables]),
  runtime_persistence: Object.freeze([...schemaBaseline.required_runtime_persistence_tables]),
});
const number = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = (value) => String(value ?? "").trim();

function triage(role, classification, issue, next, {
  objectCounts = null, missingRequired = null, authority = null, evidenceStatus = "unverified",
} = {}) {
  return {
    contract: DATABASE_SCHEMA_RECOVERY_TRIAGE_CONTRACT,
    role, classification, issue, next,
    evidence_status: evidenceStatus,
    privileged_physical_census_verified: evidenceStatus === "verified",
    object_counts: objectCounts,
    missing_required_table_count: missingRequired,
    authority_candidate: authority,
    operation_authorized: false,
    caller_supplied_sql_allowed: false,
    auto_apply_allowed: false,
    automatic_retry_allowed: false,
    mutation_performed: false,
    secrets_included: false,
  };
}

function validCensus(census, role, exactSha, databaseKey) {
  if (!census || census.contract !== "mad4b.database-physical-object-inspection.v1"
    || census.read_only !== true || census.privileged_inventory_verified !== true
    || census.role !== role || census.database_key !== databaseKey
    || census.exact_deployed_sha !== exactSha || census.database_identity_verified !== true
    || census.independent_recovery_store_verified !== true
    || census.privileges_sufficient_to_enumerate_all_objects !== true
    || census.census_complete !== true || census.census_error_count !== 0
    || census.role_boundary_verified !== true
    || !SHA_RE.test(exactSha) || !text(databaseKey)
    || !census.inspection_run_id || !/^[0-9a-f]{64}$/u.test(text(census.inspection_evidence_sha256))) return false;
  const counts = census.object_counts;
  if (!counts || OBJECT_TYPES.some((type) => number(counts[type]) === null)) return false;
  if (number(counts.total) !== OBJECT_TYPES.reduce((sum, type) => sum + counts[type], 0)) return false;
  const present = number(census.required_tables_present);
  const missing = number(census.required_tables_missing);
  const expected = number(census.required_tables_expected);
  const sourceTables = REQUIRED_SOURCE_TABLES[role] || [];
  if (present === null || missing === null || expected === null
    || expected !== sourceTables.length || expected !== present + missing) return false;
  if (counts.tables < present || census.required_objects_physically_checked !== true) return false;

  // Counts alone cannot prove that each source-required table was inspected.
  // The independent census must name each exact baseline table once and
  // retain the boolean physically-observed presence bit, never an estimate.
  const observed = census.required_table_evidence;
  if (!Array.isArray(observed) || observed.length !== sourceTables.length) return false;
  const byTable = new Map();
  for (const row of observed) {
    const table = text(row?.table);
    if (!sourceTables.includes(table) || byTable.has(table) || typeof row?.present !== "boolean") return false;
    byTable.set(table, row.present);
  }
  if (sourceTables.some((table) => !byTable.has(table))) return false;
  const countedPresent = [...byTable.values()].filter(Boolean).length;
  if (countedPresent !== present || expected - countedPresent !== missing) return false;
  return true;
}

export function classifyDatabaseSchemaRecovery({
  role, expectedDeployedSha, databaseKey, principalSchemaReadiness = null,
  privilegedCensus = null, schemaDriftVerified = false,
} = {}) {
  if (!ROLES.includes(role)) return triage(null, "blocked", "INVALID_ROLE", "resolve_target_role");
  const exactSha = text(expectedDeployedSha);
  if (!SHA_RE.test(exactSha) || !text(databaseKey)) {
    return triage(role, "blocked", "EXACT_IDENTITY_UNVERIFIED", "verify_exact_production_deployment_and_target_role");
  }
  // The app-principal schema probe may be incomplete, even when the DB itself is populated.
  // Physical classification always comes from an independent, qualified full-object census.
  if (!validCensus(privilegedCensus, role, exactSha, text(databaseKey))) {
    return triage(role, "visibility_unverified", "PHYSICAL_ABSENCE_NOT_PROVEN",
      "database_full_inspection_read_only");
  }
  const counts = privilegedCensus.object_counts;
  const missing = privilegedCensus.required_tables_missing;
  const present = privilegedCensus.required_tables_present;
  const expected = privilegedCensus.required_tables_expected;
  const metadata = { objectCounts: counts, missingRequired: missing, evidenceStatus: "verified" };
  if (counts.total === 0) {
    // A separate RecoveryKernel plan must re-verify the same-cycle fingerprint,
    // backup, isolated recovery store, exact authority binding and typed approval.
    if (present !== 0 || missing !== expected) {
      return triage(role, "blocked", "PHYSICAL_CENSUS_INCONSISTENT", "repeat_database_full_inspection", metadata);
    }
    return triage(role, "confirmed_zero_objects", "ROLE_EMPTY_UNINITIALIZED",
      "governed_baseline_rebuild_plan_only", {
        ...metadata, authority: `${role}.baseline.rebuild_empty`,
      });
  }
  if (counts.total > 0 && counts.tables === 0 && present > 0) {
    return triage(role, "blocked", "PHYSICAL_CENSUS_INCONSISTENT", "repeat_database_full_inspection", metadata);
  }
  if (missing > 0) {
    // Only exact, source-registered migrations for an existing partial role.
    // Governance partial repair cannot be routed through the empty-rebuild operation.
    return triage(role, "confirmed_partial_schema", "REQUIRED_TABLES_PHYSICALLY_MISSING",
      "prepare_registered_schema_migration_review", metadata);
  }
  if (schemaDriftVerified === true || privilegedCensus.structural_drift_verified === true) {
    return triage(role, "confirmed_structural_drift", "REQUIRED_TABLE_DEFINITION_MISMATCH",
      "prepare_registered_schema_migration_review", metadata);
  }
  if (principalSchemaReadiness?.ready === false) {
    return triage(role, "grant_or_visibility_drift", "PHYSICAL_SCHEMA_PRESENT_BUT_APP_CANNOT_SEE",
      "read_only_exact_principal_privilege_audit", metadata);
  }
  return triage(role, "confirmed_schema_present", "PHYSICAL_SCHEMA_PRESENT",
    "complete_exact_principal_grants_and_behavioral_readback", metadata);
}
