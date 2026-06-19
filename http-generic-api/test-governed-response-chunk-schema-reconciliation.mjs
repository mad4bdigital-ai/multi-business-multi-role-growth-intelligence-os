import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GOVERNED_MIGRATION_RECONCILIATION_CONFIRMATION,
  runGovernedMigrationReconciliationRuntime,
} from "./governedMigrationReconciliationRuntime.js";

const migration = readFileSync(
  "migrations/1018_sprint69_governed_response_chunk_schema_reconciliation.sql",
  "utf8"
);
const runtime = readFileSync("dynamicAuditRuntime.js", "utf8");

for (const token of [
  "information_schema.columns",
  "information_schema.statistics",
  "information_schema.table_constraints",
  "BIGINT UNSIGNED",
  "utf16_code_unit_cursor_v1",
  "updated_at DATETIME(3)",
  "idx_governed_tool_response_chunks_expires_at",
  "chk_governed_tool_response_chunks_no_secrets",
  "chk_governed_tool_response_chunks_sha256",
  "v_governed_response_chunk_schema_readiness",
  "governed_migration_reconciliation_scheduler",
  "migration_reconcile_20260618_chunk_store_record_only",
  "migration_reconcile_1018_chunk_schema_apply",
  "governed_migration_authorization_registry",
]) {
  assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(migration, /auto_apply_allowed[\s\S]*1/);
assert.match(migration, /approval_required[\s\S]*0/);
assert.match(migration, /secrets_included=false/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);
assert.match(runtime, /runGovernedMigrationReconciliationRuntime/);
assert.match(runtime, /migration_reconciliation_enabled/);
assert.match(runtime, /migration_reconciliation_apply/);
assert.match(runtime, /migration_reconciliation_limit/);
assert.match(runtime, /migration_reconciliation:\s*migrationReconciliation/);
assert.match(runtime, /migrationReconciliation\.ok\s*&&\s*bridge\.ok/);

let captured = null;
const fakeItems = Array.from({ length: 25 }, (_, index) => ({
  migration: `migration_${index}.sql`,
  decision: { action: "diagnose_only", status: "diagnose_only", reason: "test" },
}));
const result = await runGovernedMigrationReconciliationRuntime(
  {
    apply: true,
    limit: 9999,
    migration: "../1018_sprint69_governed_response_chunk_schema_reconciliation.sql",
  },
  {
    execFileAsync: async (command, args, options) => {
      captured = { command, args, options };
      return {
        stdout: JSON.stringify({
          ok: true,
          run_id: "test-run",
          mode: "apply",
          policy_available: true,
          policy_key: "governed_migration_reconciliation_v1",
          migration_count: fakeItems.length,
          ready_count: 1,
          executed_count: 1,
          blocked_count: 0,
          items: fakeItems,
          secrets_included: false,
        }),
        stderr: "",
      };
    },
  }
);

assert.equal(result.ok, true);
assert.equal(result.output.ok, true);
assert.equal(result.output.item_sample.length, 20);
assert.equal(result.output.items_omitted, 5);
assert.equal(result.output.raw_payload_stored, false);
assert.equal(result.output.secrets_included, false);
assert.equal(captured.command, process.execPath);
assert(captured.args.some((arg) => arg === "--apply"));
assert(captured.args.some((arg) => arg === `--confirm=${GOVERNED_MIGRATION_RECONCILIATION_CONFIRMATION}`));
assert(captured.args.some((arg) => arg === "--limit=2000"));
assert(captured.args.some((arg) => arg === "--migration=1018_sprint69_governed_response_chunk_schema_reconciliation.sql"));
assert.equal(captured.options.windowsHide, true);
assert.equal(captured.options.maxBuffer, 32 * 1024 * 1024);

const failure = await runGovernedMigrationReconciliationRuntime(
  { apply: false },
  {
    execFileAsync: async () => {
      const error = new Error("runner failed");
      error.stderr = JSON.stringify({
        ok: false,
        error: { code: "preflight_failed", message: "Migration preflight failed." },
        secrets_included: false,
      });
      throw error;
    },
  }
);
assert.equal(failure.ok, false);
assert.equal(failure.error.code, "preflight_failed");
assert.equal(failure.raw_payload_stored, false);
assert.equal(failure.secrets_included, false);

console.log("governed response chunk schema reconciliation tests passed");
