import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  governedMigrationApplyConfirmation,
  inspectGovernedMigrationExecution,
  runGovernedMigrationExecution,
  splitGovernedMigrationStatements,
} from "./governedMigrationExecutionTool.js";

const MIGRATION = "1025_sprint69_resource_surface_policy_governance.sql";
const SQL = readFileSync(`migrations/${MIGRATION}`, "utf8");
const CHECKSUM = createHash("sha256").update(SQL, "utf8").digest("hex");
const STATEMENT_COUNT = splitGovernedMigrationStatements(SQL).length;
const ENVELOPE_ID = "11111111-2222-4333-8444-555555555555";

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
    ledger: { recorded: true, run_id: "run-1025" },
  };
}

{
  const inspected = await inspectGovernedMigrationExecution(baseInput());
  assert.equal(inspected.migration_checksum_sha256, CHECKSUM);
  assert.equal(inspected.statement_count, STATEMENT_COUNT);
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
  let executed = false;
  await assert.rejects(
    () => runGovernedMigrationExecution({ ...baseInput("apply"), confirm: "WRONG" }, {
      execFile: async () => {
        executed = true;
        return { stdout: JSON.stringify(fakeResult("apply")), stderr: "" };
      },
      authorizeApply: async () => ({ envelope_id: ENVELOPE_ID }),
    }),
    (error) => error.code === "migration_apply_confirmation_required"
  );
  assert.equal(executed, false);
}

{
  let authorized = false;
  const result = await runGovernedMigrationExecution(baseInput("apply"), {
    authorizeApply: async (inspection) => {
      authorized = true;
      assert.equal(inspection.capabilityEnvelopeId, ENVELOPE_ID);
      return { envelope_id: ENVELOPE_ID };
    },
    execFile: async (_command, args) => {
      assert.ok(args.includes("--apply"));
      assert.ok(args.includes(`--confirm=${governedMigrationApplyConfirmation(MIGRATION)}`));
      return { stdout: JSON.stringify(fakeResult("apply")), stderr: "" };
    },
  });
  assert.equal(authorized, true);
  assert.equal(result.ledger.recorded, true);
  assert.equal(result.capability_envelope_id, ENVELOPE_ID);
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
        error.stderr = "SECRET_DATABASE_PASSWORD=do-not-return";
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.code, "governed_migration_runner_failed");
      assert.equal(error.details.exit_code, 9);
      assert.equal(error.details.stderr_preview, undefined);
      assert.doesNotMatch(JSON.stringify(error.details), /SECRET_DATABASE_PASSWORD/);
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
