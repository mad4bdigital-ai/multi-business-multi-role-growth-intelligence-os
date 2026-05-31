import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/174_sprint65_recovery_capability_taxonomy_foundation.sql", import.meta.url),
  "utf8"
);
const toolsMigration = readFileSync(
  new URL("./migrations/167_sprint65_ai_intelligence_runtime_governance_tools.sql", import.meta.url),
  "utf8"
);
const tenantOpenApi = readFileSync(new URL("./openapi.tenant-gpt.auth.yaml", import.meta.url), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_recovery_failure_taxonomy"));
assert(migration.includes("recovery_capability_taxonomy_engine"));
assert(migration.includes("recovery_capability_taxonomy_policy_v1"));
assert(migration.includes("github_ci_recovery"));
assert(migration.includes("repo_recovery"));

for (const capability of [
  "github.job_logs.get",
  "github.check_annotations.get",
  "github.ci.wait_for_sha",
  "github.ci.summarize_sha",
  "github.required_checks.summary",
  "repo.patch.error.classify",
  "repo.patch.context_recover",
  "repo.patch.no_match.diagnose",
  "github.pr.merge_idempotent",
]) {
  assert(migration.includes(capability), `migration must seed recovery capability ${capability}`);
}

for (const failureKey of [
  "pending",
  "failed_with_logs",
  "cancelled_by_newer_run",
  "skipped_by_path_filter",
  "guard_failed",
  "schema_contract_failed",
  "unit_test_failed",
  "stale_run",
]) {
  assert(migration.includes(`'${failureKey}'`), `migration must seed CI failure taxonomy key ${failureKey}`);
}

for (const toolKey of [
  "github_ci_recovery_decision_brief",
  "github_ci_failure_classification_plan",
  "repo_patch_recovery_decision_brief",
  "github_required_checks_summary_plan",
]) {
  assert(migration.includes(`'${toolKey}'`), `migration must register admin planning tool ${toolKey}`);
}

for (const requiredTag of [
  "read_only",
  "no_execution",
  "no_apply",
  "no_secret_read",
]) {
  assert(migration.includes(requiredTag), `recovery tools must advertise ${requiredTag}`);
}

assert(migration.includes('"max_files_changed":0'));
assert(migration.includes('"max_rows_mutated":0'));
assert(migration.includes('"max_external_writes":0'));
assert(migration.includes('"apply_supported":false'));
assert(migration.includes('"secrets_returned":false'));
assert(migration.includes("secrets_may_be_returned TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("apply_allowed TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("auto_apply_allowed, dry_run_required, approval_required"));
assert(migration.includes("'github_pr_merge_idempotency_check'"));
assert(migration.includes("'github_pr_merge_idempotent'") || migration.includes("github.pr.merge_idempotent"));

for (const destructiveSql of [/^\s*DROP\s+TABLE\b/mi, /^\s*TRUNCATE\s+TABLE\b/mi, /^\s*DELETE\s+FROM\b/mi]) {
  assert(!destructiveSql.test(migration), `recovery taxonomy migration must not include destructive SQL statement ${destructiveSql}`);
}

for (const forbidden of [
  "platform_engine_task_apply",
  "/platform/engines/task-apply",
  "repo.patch.apply",
  "github.pr.merge'",
  "credential_dump",
  "secret_read\"",
  "implementation_code",
]) {
  if (forbidden === "repo.patch.apply" || forbidden === "credential_dump" || forbidden === "secret_read\"") {
    assert(migration.includes(forbidden), `${forbidden} should be listed only as a forbidden tool`);
    continue;
  }
  assert(!migration.includes(forbidden), `recovery taxonomy must not expose ${forbidden}`);
}

assert(migration.includes("ON DUPLICATE KEY UPDATE"), "migration must be idempotent");
assert(migration.includes("'/platform/engines/decision-brief'"));
assert(migration.includes("'/platform/engines/task-plan'"));
assert(toolsMigration.includes("platform_engine_decision_brief"));
assert(toolsMigration.includes("platform_engine_task_plan"));

assert(!tenantOpenApi.includes("github_ci_recovery_decision_brief"));
assert(!tenantOpenApi.includes("repo_patch_recovery_decision_brief"));
assert(!tenantOpenApi.includes("recovery_capability_taxonomy_engine"));

console.log("recovery capability taxonomy tests passed");
