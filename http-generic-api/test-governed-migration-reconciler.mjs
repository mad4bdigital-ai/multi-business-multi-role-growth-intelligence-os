import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/governed-migration-reconciler.mjs", "utf8");
const migration = readFileSync("migrations/308_sprint69_dynamic_governed_migration_reconciliation.sql", "utf8");
const policy = readFileSync("governedMigrationReconciliationPolicy.mjs", "utf8");
const cliRoutes = readFileSync("routes/adminCliRoutes.js", "utf8");
const rollupBuilder = readFileSync("scripts/audit-event-rollup-builder.mjs", "utf8");
const automationTick = readFileSync("scripts/governed-platform-automation-tick.mjs", "utf8");
const dynamicAuditRuntime = readFileSync("dynamicAuditRuntime.js", "utf8");

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

assert(script.includes("classifyMigrationReconciliationDecision"));
assert(policy.includes("no_active_explicit_rule"));
assert(policy.includes("record_only_requires_complete_schema"));
assert(policy.includes("use_record_only_rule_instead_of_reapplying"));
assert(policy.includes("risk_requires_approval_but_rule_not_preapproved"));
assert(policy.includes("record_only_requires_explicit_policy_only_contract"));
assert(policy.includes("policy_only_record_only_apply_must_be_disabled"));
assert(policy.includes("policy_only_record_only_checksum_mismatch"));
assert(script.includes("APPLY_GOVERNED_MIGRATION_RECONCILIATION"));
assert(script.includes("governed-migration-runner.mjs"));
assert(script.includes('typeof parsed.message === "string"'));
assert(script.includes("JSON.parse(parsed.message)"));
assert(script.includes(".reverse()"));
assert(!script.includes("eval("));

assert(migration.includes("'diagnose_only'"));
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration));
assert(cliRoutes.includes("migration_reconciliation_dry_run"));
assert(cliRoutes.includes("migration_reconciliation_apply"));
assert(cliRoutes.includes("governed_platform_automation_tick"));
assert(rollupBuilder.includes("governed_migration_reconciliation"));
assert(rollupBuilder.includes("database_migration"));
assert.match(automationTick, /parseStructuredOutput/);
assert.match(automationTick, /boundedReconciliation/);
assert.match(automationTick, /runDynamicAuditCycle/);
assert.match(automationTick, /continuous_scheduler_external: false/);
assert.doesNotMatch(automationTick, /items:\s*output\.items/);
assert.match(dynamicAuditRuntime, /internal_runtime_interval_with_mysql_advisory_lock/);
assert.match(dynamicAuditRuntime, /dynamic_audit_scheduler_runs/);
assert.match(dynamicAuditRuntime, /secrets_included: false/);

console.log("governed migration reconciler and automation tick contract tests passed");
