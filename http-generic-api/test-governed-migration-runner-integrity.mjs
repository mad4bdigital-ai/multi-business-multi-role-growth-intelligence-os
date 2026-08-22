import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enforceAuthorizationArtifactBinding } from "./scripts/governed-migration-runner.mjs";

const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const bootstrap = readFileSync("scripts/governed-migration-runner-bootstrap.mjs", "utf8");
const executor = readFileSync("governedMigrationExecutionTool.js", "utf8");

assert.match(runner, /export async function runGovernedMigrationRunner/u);
assert.match(bootstrap, /runGovernedMigrationRunner\(process\.argv\.slice\(2\)\)/u);
assert.match(runner, /metadata_json/u);
assert.match(runner, /parseMetadataJson/u);
assert.match(runner, /enforceAuthorizationArtifactBinding/u);
assert.match(runner, /governed_migration_authorization_checksum_mismatch/u);
assert.match(runner, /governed_migration_authorization_statement_count_mismatch/u);
assert.match(runner, /governed_migration_authorization_checksum_binding_required/u);
assert.match(runner, /PREFLIGHT_QUERY_TIMEOUT_MS/u);
assert.match(runner, /function preflightQuery\(/u);
assert.match(runner, /schema_readback_required: true/u);
assert.match(runner, /required_readback_tool: "governed_migration_schema_readback"/u);
assert.ok(
  runner.indexOf("existing_apply_ledger_lookup_started") < runner.indexOf("schema_preflight_started"),
  "exact apply-ledger lookup must precede live schema preflight",
);
const applyStart = runner.indexOf("async function applyStatements");
const applyEnd = runner.indexOf("\n}\n\nfunction sha256", applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart, "applyStatements must remain present");
const applySource = runner.slice(applyStart, applyEnd);
assert.match(applySource, /pool\.query\(statement\)/u, "DDL apply must retain raw pool.query(statement)");
assert.doesNotMatch(applySource, /preflightQuery/u, "bounded preflight query must not be used for DDL apply");

const checksum = "a".repeat(64);
const matchingAuthorization = {
  row: {
    metadata_json: JSON.stringify({ migration_checksum_sha256: checksum, expected_statement_count: 6 }),
  },
};
enforceAuthorizationArtifactBinding({ authorization: matchingAuthorization, checksum, statementCount: 6, exactApplyLedger: null });

assert.throws(
  () => enforceAuthorizationArtifactBinding({ authorization: matchingAuthorization, checksum: "b".repeat(64), statementCount: 6, exactApplyLedger: null }),
  (error) => error.code === "governed_migration_authorization_checksum_mismatch",
);
assert.throws(
  () => enforceAuthorizationArtifactBinding({ authorization: matchingAuthorization, checksum, statementCount: 5, exactApplyLedger: null }),
  (error) => error.code === "governed_migration_authorization_statement_count_mismatch",
);
assert.throws(
  () => enforceAuthorizationArtifactBinding({
    authorization: { row: { metadata_json: JSON.stringify({ migration_checksum_sha256: checksum }) } },
    checksum,
    statementCount: 6,
    exactApplyLedger: null,
  }),
  (error) => error.code === "governed_migration_authorization_statement_count_mismatch",
);
enforceAuthorizationArtifactBinding({
  authorization: { row: { authorization_source: "ledger_backfill_from_governed_runner_history" } },
  checksum,
  statementCount: 6,
  exactApplyLedger: { run_id: "historical-apply-run" },
});
assert.throws(
  () => enforceAuthorizationArtifactBinding({
    authorization: { row: { authorization_source: "ledger_backfill_from_governed_runner_history" } },
    checksum,
    statementCount: 6,
    exactApplyLedger: null,
  }),
  (error) => error.code === "governed_migration_authorization_checksum_binding_required",
);

assert.match(executor, /DEFAULT_DRY_RUN_RUNNER_TIMEOUT_MS = 45_000/u);
assert.match(executor, /GOVERNED_MIGRATION_RUNNER_TIMEOUT_MS/u);
assert.match(executor, /Math\.min\(normalizedTimeoutMs, DEFAULT_DRY_RUN_RUNNER_TIMEOUT_MS\)/u);
assert.match(executor, /governed_migration_runner_invalid_applied_readback/u);
assert.match(executor, /live_schema_preflight_skipped/u);

console.log(JSON.stringify({
  ok: true,
  contract: "governed-migration-runner-integrity.v2",
  lifecycle_exported: true,
  exact_apply_ledger_gate: true,
  checksum_bound_authorization: true,
  statement_count_bound_authorization: true,
  bounded_read_only_preflight: true,
  ddl_apply_raw_query_preserved: true,
  dry_run_timeout_cap_ms: 45000,
  applied_readback_requires_schema_readback: true,
  secrets_included: false,
}));
