import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/254_sprint68_session_insight_scope_link_monitoring.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("./sessionSummaryService.js", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert.ok(migration.includes("CREATE OR REPLACE VIEW `v_session_insight_scope_link_issues`"), "migration must create scope-link diagnostics view");
for (const issueCode of [
  "candidate_missing_scope_links",
  "candidate_scope_link_unregistered_type",
  "candidate_scope_link_secret_flagged",
]) {
  assert.ok(migration.includes(issueCode), `diagnostics must include ${issueCode}`);
}
assert.ok(migration.includes("resource_type = 'session_insight_candidate'"), "diagnostics must target insight candidate memory scope links");
assert.ok(migration.includes("linkage_type = 'insight_candidate_scope_attachment'"), "diagnostics must target the stable insight candidate linkage type");

assert.ok(service.includes("writeInsightCandidateScopeLinks"), "session summary service must write memory scope links for insight candidates");
assert.ok(service.includes("resource_type, resource_ref, resource_table, resource_pk"), "insight candidate scope writer must use generic memory_scope_links resource columns");
assert.ok(service.includes("session_insight_candidate"), "insight candidate scope writer must use session_insight_candidate resource type");
assert.ok(service.includes("insight_candidate_scope_attachment"), "insight candidate scope writer must use a stable linkage type");
assert.ok(service.includes("memoryScopeIdentityHash(\"session_insight_candidate\""), "insight candidate scope links must use explicit resource/scope hash identity");
assert.ok(service.includes("safeJsonParse(seed.suggested_scopes_json"), "scope writer must derive links from suggested_scopes_json");
assert.ok(service.includes("approval_required"), "scope links must carry approval requirement metadata");
assert.ok(service.includes("secrets_included: false"), "scope links must preserve no-secret metadata");
assert.ok(!service.includes("promotion_status = 'promoted'"), "scope-link writer must not promote candidates");

assert.ok(runner.includes("254_sprint68_session_insight_scope_link_monitoring.sql"), "governed migration runner must register migration 254");
assert.ok(readiness.includes("254_sprint68_session_insight_scope_link_monitoring.sql"), "release readiness must track migration 254");

console.log("session insight scope link foundation contract passed");
