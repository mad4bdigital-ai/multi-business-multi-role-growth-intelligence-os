import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  governedMigrationApplyConfirmation,
  inspectGovernedMigrationExecution,
  runGovernedMigrationExecution,
  splitGovernedMigrationStatements,
} from "./governedMigrationExecutionTool.js";
import { assessMigrationSqlPreflight, splitSqlStatements } from "./releaseReadiness.js";
import {
  READINESS_REPAIR_CHECKSUM as PINNED_READINESS_REPAIR_CHECKSUM,
  assessReadinessRepairState,
  assertReadinessRepairStatements,
} from "./scripts/repository-authority-capability-readiness-repair-runner.mjs";

const MIGRATION = "1025_sprint69_resource_surface_policy_governance.sql";
const SQL = readFileSync(`migrations/${MIGRATION}`, "utf8");
const CHECKSUM = createHash("sha256").update(SQL, "utf8").digest("hex");
const STATEMENT_COUNT = splitGovernedMigrationStatements(SQL).length;
const ENVELOPE_ID = "11111111-2222-4333-8444-555555555555";
const PARITY_MIGRATION = "1025_sprint69_growth_audit_evidence_admin_tenant_support.sql";
const PARITY_SQL = readFileSync(`migrations/${PARITY_MIGRATION}`, "utf8");
const TRIGGER_MIGRATION = "20260720_tenant_export_manifest_eligibility_hardening.sql";
const TRIGGER_SQL = readFileSync(`migrations/${TRIGGER_MIGRATION}`, "utf8");
const READINESS_REPAIR_MIGRATION = "20260725_repository_authority_capability_readiness_repair.sql";
const READINESS_REPAIR_SQL = readFileSync(`migrations/${READINESS_REPAIR_MIGRATION}`, "utf8");
const READINESS_REPAIR_CHECKSUM = createHash("sha256").update(READINESS_REPAIR_SQL, "utf8").digest("hex");
const READINESS_REPAIR_STATEMENT_COUNT = splitGovernedMigrationStatements(READINESS_REPAIR_SQL).length;

assert.equal(READINESS_REPAIR_CHECKSUM, PINNED_READINESS_REPAIR_CHECKSUM);
assert.equal(READINESS_REPAIR_STATEMENT_COUNT, 3);
assert.equal(
  assertReadinessRepairStatements(splitGovernedMigrationStatements(READINESS_REPAIR_SQL)),
  true,
);
assert.throws(
  () => assertReadinessRepairStatements(["INSERT INTO a VALUES (1)", "ALTER TABLE a ADD b INT", "UPDATE a SET b=1"]),
  (error) => error.code === "readiness_repair_non_transactional_statement_blocked",
);

function readinessState(overrides = {}) {
  return {
    system: { system_id: "system-1", status: "active", service_mode: "managed", managed_capable: 1 },
    authority: {
      system_id: "old-system", installation_id: "installation-1",
      system_binding_mode: "shared_platform_adapter", lifecycle_status: "active",
    },
    capability: { policy_key: "old-policy", lifecycle_status: "active" },
    policy: { policy_key: "target-policy", status: "active", runtime_surface: "system_layer" },
    authorization: { authorization_status: "authorized", allow_apply: 1 },
    collations: [{ collation_name: "utf8mb4_unicode_ci" }, { collation_name: "utf8mb4_uca1400_ai_ci" }],
    ledger: null,
    ...overrides,
  };
}

assert.equal(assessReadinessRepairState(readinessState()).recommended_action, "apply");
assert.equal(
  assessReadinessRepairState(readinessState({
    authority: {
      system_id: "system-1", installation_id: null,
      system_binding_mode: "shared_platform_adapter", lifecycle_status: "active",
    },
    capability: { policy_key: "target-policy", lifecycle_status: "active" },
  })).recommended_action,
  "record_only",
);
assert.equal(
  assessReadinessRepairState(readinessState({
    authorization: { authorization_status: "authorized", allow_apply: 0 },
  })).status,
  "blocked",
);

{
  const executionStatements = splitGovernedMigrationStatements(PARITY_SQL);
  const readinessStatements = splitSqlStatements(PARITY_SQL);
  assert.equal(executionStatements.length, 10);
  assert.deepEqual(executionStatements, readinessStatements);
}

{
  const executionStatements = splitGovernedMigrationStatements(TRIGGER_SQL);
  const readinessStatements = splitSqlStatements(TRIGGER_SQL);
  assert.equal(executionStatements.length, 7);
  assert.deepEqual(executionStatements, readinessStatements);
  assert.match(executionStatements[0], /CREATE OR REPLACE VIEW v_platform_exports_current/i);
  assert.match(executionStatements[1], /^UPDATE platform_plugin_capability_exports e/i);

  const expectedTriggerNames = [
    "trg_tenant_export_manifest_guard_before_insert",
    "trg_tenant_export_manifest_guard_before_update",
    "trg_tenant_export_manifest_guard_after_manifest_insert",
    "trg_tenant_export_manifest_guard_after_manifest_update",
    "trg_tenant_export_manifest_guard_after_manifest_delete",
  ];
  assert.deepEqual(
    executionStatements.slice(2).map((statement) =>
      statement.match(/^CREATE OR REPLACE TRIGGER\s+([A-Za-z0-9_]+)/i)?.[1] || null
    ),
    expectedTriggerNames
  );
  for (const statement of executionStatements.slice(2)) {
    assert.match(statement, /FOR EACH ROW/i);
    assert.match(statement, /(?:SET\s+NEW\.|UPDATE\s+platform_plugin_capability_exports)/i);
  }

  const preflight = assessMigrationSqlPreflight(TRIGGER_MIGRATION, TRIGGER_SQL);
  assert.equal(preflight.counts.statements, 7);
  assert.equal(preflight.status, "pass");
}

function baseInput(mode = "dry_run") {
  return {
    migration: MIGRATION,
    mode,
    expected_checksum_sha256: CHECKSUM,
    expected_statement_count: STATEMENT_COUNT,
    capability_envelope_id: mode === "apply" ? ENVELOPE_ID : undefined,
    confirm: mode === "apply" ? governedMigrationApplyConfirmation(MIGRATION) : undefined,
  };
}

function readinessRepairInput(mode = "dry_run") {
  return {
    migration: READINESS_REPAIR_MIGRATION,
    mode,
    expected_checksum_sha256: READINESS_REPAIR_CHECKSUM,
    expected_statement_count: READINESS_REPAIR_STATEMENT_COUNT,
    capability_envelope_id: mode === "apply" ? ENVELOPE_ID : undefined,
    confirm: mode === "apply" ? governedMigrationApplyConfirmation(READINESS_REPAIR_MIGRATION) : undefined,
  };
}

function authorizedEnvelope(overrides = {}) {
  return {
    envelope_id: ENVELOPE_ID,
    apply_allowed: true,
    readback_required: true,
    ...overrides,
  };
}

function fakeResult(mode) {
  const base = {
    ok: true,
    mode,
    migration: MIGRATION,
    migration_checksum_sha256: CHECKSUM,
    statement_count: STATEMENT_COUNT,
    requirements: { schema_objects: ["platform_resource_surface_policy_registry", "v_platform_resource_api_coverage"] },
    after_schema_objects: ["platform_resource_surface_policy_registry", "v_platform_resource_api_coverage"],
    secrets_included: false,
  };
  if (mode === "dry_run") return { ...base, applies_sql: false };
  return {
    ...base,
    applies_sql: true,
    statements_executed: STATEMENT_COUNT,
    ledger: { recorded: true, run_id: "run-1025", capability_envelope_id: ENVELOPE_ID },
  };
}

function fakeReadinessRepairResult(mode) {
  const base = {
    ok: true,
    mode,
    migration: READINESS_REPAIR_MIGRATION,
    migration_checksum_sha256: READINESS_REPAIR_CHECKSUM,
    statement_count: READINESS_REPAIR_STATEMENT_COUNT,
    requirements: { schema_objects: ["connected_systems", "repository_authority_bindings"] },
    after_schema_objects: ["connected_systems", "repository_authority_bindings"],
    secrets_included: false,
  };
  if (mode === "dry_run") return { ...base, applies_sql: false };
  return {
    ...base,
    applies_sql: true,
    statements_executed: READINESS_REPAIR_STATEMENT_COUNT,
    atomic_transaction: true,
    same_cycle_row_readback_verified: true,
    capability_envelope: { envelope_id: ENVELOPE_ID, consumed: true },
    ledger: { recorded: true, run_id: "run-readiness-repair", capability_envelope_id: ENVELOPE_ID },
  };
}

{
  const inspected = await inspectGovernedMigrationExecution(baseInput());
  assert.equal(inspected.migration_checksum_sha256, CHECKSUM);
  assert.equal(inspected.statement_count, STATEMENT_COUNT);
  assert.equal(inspected.atomic_runner_required, false);
}

{
  const inspected = await inspectGovernedMigrationExecution(readinessRepairInput());
  assert.equal(inspected.migration_checksum_sha256, READINESS_REPAIR_CHECKSUM);
  assert.equal(inspected.statement_count, 3);
  assert.equal(inspected.atomic_runner_required, true);
  assert.equal(path.basename(inspected.runner_path), "repository-authority-capability-readiness-repair-runner.mjs");
}

{
  let executed = false;
  const result = await runGovernedMigrationExecution(baseInput(), {
    execFile: async () => {
      executed = true;
      return { stdout: JSON.stringify(fakeResult("dry_run")), stderr: "" };
    },
  });
  assert.equal(executed, true);
  assert.equal(result.applies_sql, false);
  assert.equal(result.same_cycle_readback_verified, true);
}

{
  const structuredEnvelope = {
    timestamp: "2026-06-26T14:35:39.644Z",
    level: "LOG",
    message: JSON.stringify(fakeResult("dry_run"), null, 2),
  };
  const result = await runGovernedMigrationExecution(baseInput(), {
    execFile: async () => ({ stdout: JSON.stringify(structuredEnvelope), stderr: "" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry_run");
  assert.equal(result.applies_sql, false);
  assert.equal(result.same_cycle_readback_verified, true);
}

{
  let executed = false;
  await assert.rejects(
    () => runGovernedMigrationExecution({ ...baseInput("apply"), confirm: "WRONG" }, {
      execFile: async () => {
        executed = true;
        return { stdout: JSON.stringify(fakeResult("apply")), stderr: "" };
      },
      authorizeApply: async () => authorizedEnvelope(),
    }),
    (error) => error.code === "migration_apply_confirmation_required"
  );
  assert.equal(executed, false);
}

{
  let executed = false;
  await assert.rejects(
    () => runGovernedMigrationExecution(baseInput("apply"), {
      authorizeApply: async () => authorizedEnvelope({ apply_allowed: false }),
      execFile: async () => {
        executed = true;
        return { stdout: JSON.stringify(fakeResult("apply")), stderr: "" };
      },
    }),
    (error) => error.code === "governed_migration_apply_not_allowed" && error.status === 403,
  );
  assert.equal(executed, false);
}

{
  let executed = false;
  await assert.rejects(
    () => runGovernedMigrationExecution(baseInput("apply"), {
      authorizeApply: async () => authorizedEnvelope({ readback_required: false }),
      execFile: async () => {
        executed = true;
        return { stdout: JSON.stringify(fakeResult("apply")), stderr: "" };
      },
    }),
    (error) => error.code === "governed_migration_readback_not_required" && error.status === 403,
  );
  assert.equal(executed, false);
}

{
  let authorized = false;
  const result = await runGovernedMigrationExecution(baseInput("apply"), {
    authorizeApply: async (inspection) => {
      authorized = true;
      assert.equal(inspection.capabilityEnvelopeId, ENVELOPE_ID);
      return authorizedEnvelope();
    },
    execFile: async (_command, args) => {
      assert.ok(args.includes("--apply"));
      assert.ok(args.includes(`--confirm=${governedMigrationApplyConfirmation(MIGRATION)}`));
      assert.ok(args.includes(`--capability-envelope-id=${ENVELOPE_ID}`));
      return { stdout: JSON.stringify(fakeResult("apply")), stderr: "" };
    },
  });
  assert.equal(authorized, true);
  assert.equal(result.ledger.recorded, true);
  assert.equal(result.ledger.capability_envelope_id, ENVELOPE_ID);
  assert.equal(result.capability_envelope_id, ENVELOPE_ID);
}

{
  await assert.rejects(
    () => runGovernedMigrationExecution(readinessRepairInput(), {
      execFile: async () => ({
        stdout: JSON.stringify({
          ...fakeReadinessRepairResult("dry_run"),
          preflight: { status: "already_satisfied", recommended_action: "record_only" },
        }),
        stderr: "",
      }),
    }),
    (error) => error.code === "governed_migration_record_only_manual_readback_required" && error.status === 409,
  );
}

{
  let runnerPath = "";
  const result = await runGovernedMigrationExecution(readinessRepairInput("apply"), {
    authorizeApply: async () => authorizedEnvelope(),
    execFile: async (_command, args) => {
      runnerPath = args[0];
      return { stdout: JSON.stringify(fakeReadinessRepairResult("apply")), stderr: "" };
    },
  });
  assert.equal(path.basename(runnerPath), "repository-authority-capability-readiness-repair-runner.mjs");
  assert.equal(result.atomic_transaction, true);
  assert.equal(result.capability_envelope.consumed, true);
  assert.equal(result.same_cycle_readback_verified, true);
}

{
  await assert.rejects(
    () => runGovernedMigrationExecution(readinessRepairInput("apply"), {
      authorizeApply: async () => authorizedEnvelope(),
      execFile: async () => ({
        stdout: JSON.stringify({
          ...fakeReadinessRepairResult("apply"),
          atomic_transaction: false,
        }),
        stderr: "",
      }),
    }),
    (error) => error.code === "governed_migration_atomic_readback_failed",
  );
}

{
  let executed = false;
  await assert.rejects(
    () => runGovernedMigrationExecution({ ...baseInput(), expected_checksum_sha256: "0".repeat(64) }, {
      execFile: async () => {
        executed = true;
        return { stdout: JSON.stringify(fakeResult("dry_run")), stderr: "" };
      },
    }),
    (error) => error.code === "migration_checksum_mismatch"
  );
  assert.equal(executed, false);
}

{
  await assert.rejects(
    () => runGovernedMigrationExecution(baseInput(), {
      execFile: async () => {
        const error = new Error("runner failed");
        error.code = 9;
        error.signal = "SIGTERM";
        error.stderr = "ER_CHECK_CONSTRAINT_VIOLATED: input_schema must contain valid JSON\nSECRET_DATABASE_PASSWORD=do-not-return";
        error.stdout = "Bearer abc.def.ghi";
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.code, "governed_migration_runner_failed");
      assert.equal(error.status, 409);
      assert.equal(error.details.exit_code, 9);
      assert.equal(error.details.signal, "SIGTERM");
      assert.equal(error.details.runner_error_code, "ER_CHECK_CONSTRAINT_VIOLATED");
      assert.match(error.details.stderr_summary, /input_schema must contain valid JSON/);
      assert.match(error.details.stderr_summary, /SECRET_DATABASE_PASSWORD=\[redacted\]/);
      assert.match(error.details.stdout_summary, /Bearer \[redacted\]/);
      assert.doesNotMatch(JSON.stringify(error.details), /do-not-return|abc\.def\.ghi/);
      assert.equal(error.details.retry_without_readback_allowed, false);
      assert.equal(error.details.secrets_included, false);
      return true;
    }
  );
}

{
  const source = readFileSync("routes/gptToolsRoutes.js", "utf8");
  assert.match(source, /name: "governed_migration_execute"/);
  assert.match(source, /tags: \["admin", "migration", "mutation", "dry_run_default", "typed_confirmation", "capability_envelope", "same_cycle_readback"/);
  assert.match(source, /toolKey === "governed_migration_execute"/);
}

console.log("governed migration execution tool tests passed");
