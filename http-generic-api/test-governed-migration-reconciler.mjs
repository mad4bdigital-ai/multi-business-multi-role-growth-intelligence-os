import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/governed-migration-reconciler.mjs", "utf8");
const migration = readFileSync("migrations/308_sprint69_dynamic_governed_migration_reconciliation.sql", "utf8");
const cliRoutes = readFileSync("routes/adminCliRoutes.js", "utf8");
const rollupBuilder = readFileSync("scripts/audit-event-rollup-builder.mjs", "utf8");

for (const token of [
  "platform_engine_registry",
  "platform_engine_policy_registry",
  "platform_engine_policy_rules",
]) {
  assert(script.includes(token), `reconciler must use ${token}`);
  assert(migration.includes(token), `migration must create or seed ${token}`);
}
for (const token of [
  "platform_engine_execution_runs",
  "platform_audit_event_bus",
  "governed_migration_authorization_registry",
  "governed_migration_ledger",
]) {
  assert(script.includes(token), `reconciler must use ${token}`);
}

assert(script.includes("no_active_explicit_rule"), "reconciler must deny automatic mutation without an explicit DB rule");
assert(script.includes("record_only_requires_complete_schema"), "record-only must require complete schema evidence");
assert(script.includes("use_record_only_rule_instead_of_reapplying"), "reconciler must not replay SQL when schema evidence is complete");
assert(script.includes("risk_requires_approval_but_rule_not_preapproved"), "high-risk automation must remain approval governed");
assert(script.includes("APPLY_GOVERNED_MIGRATION_RECONCILIATION"), "apply mode must require an outer typed confirmation");
assert(script.includes("governed-migration-runner.mjs"), "reconciler must delegate mutations to the governed runner");
assert(script.includes('typeof parsed.message === "string"'), "reconciler must unwrap structured logger message payloads");
assert(script.includes("JSON.parse(parsed.message)"), "reconciler must parse nested governed runner JSON results");
assert(script.includes(".reverse()"), "reconciler must scan output from the latest JSON line first");
assert(!script.includes("eval("), "reconciler must not execute DB-stored code");

assert(migration.includes("'diagnose_only'"), "default policy must remain diagnose-only");
assert(migration.includes("'305_sprint69_runtime_verification_control_plane_hardening.sql'"), "migration must seed approved 305 record-only rule");
assert(migration.includes("'306_sprint69_session_insight_target_write_readback.sql'"), "migration must seed approved 306 apply rule");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "reconciliation migration must be additive");

assert(cliRoutes.includes("migration_reconciliation_dry_run"), "admin CLI must expose reconciliation dry-run");
assert(cliRoutes.includes("migration_reconciliation_apply"), "admin CLI must expose gated reconciliation apply");
assert(cliRoutes.includes("governed_platform_automation_tick"), "admin CLI must expose the continuous-ready governed automation tick");
assert(rollupBuilder.includes("governed_migration_reconciliation"), "dynamic audit rollups must consume governed migration reconciliation events");
assert(rollupBuilder.includes("database_migration"), "migration reconciliation events must classify as DB change evidence");

console.log("governed migration reconciler contract tests passed");
