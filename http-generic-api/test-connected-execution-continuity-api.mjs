import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/connectedExecutionRoutes.js", "utf8");
const index = readFileSync("routes/index.js", "utf8");
const migration = readFileSync("migrations/187_sprint66_connected_execution_continuity_api_tools.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const readiness = readFileSync("releaseReadiness.js", "utf8");

assert(routes.includes("/connected-execution/sessions"));
assert(routes.includes("/connected-execution/sessions/:connected_session_id/checkpoint"));
assert(routes.includes("/connected-execution/sessions/:connected_session_id/evidence-reports"));
assert(routes.includes("/connected-execution/sessions/:connected_session_id/resume-actions"));
assert(routes.includes("executes_action: false"));
assert(routes.includes("secrets_included: false"));
assert(routes.includes("requires_claim_before_execution"));
assert(!routes.includes("claim_token ="));
assert(!routes.includes("status = 'running'"));
assert(!routes.includes("fetch("));

assert(index.includes("buildConnectedExecutionRoutes"));
assert(index.includes("./connectedExecutionRoutes.js"));

for (const tool of [
  "connected_execution_session_upsert",
  "connected_execution_latest_checkpoint_get",
  "connected_execution_evidence_report_create",
  "connected_execution_resume_action_enqueue",
]) {
  assert(migration.includes(tool), `migration registers ${tool}`);
}
assert(migration.includes("connected_execution_continuity_api_tools_v1"));
assert(migration.includes("no_worker"));
assert(migration.includes("no_action_execution"));
assert(migration.includes("apply_allowed"));
assert(!/DROP\s+/i.test(migration));
assert(!/DELETE\s+/i.test(migration));
assert(!/TRUNCATE\s+/i.test(migration));
assert(!/CAST\s*\(\s*\?\s+AS\s+JSON\s*\)/i.test(migration));

assert(openapi.includes("name: connected-execution"));
assert(openapi.includes("/connected-execution/sessions:"));
assert(openapi.includes("/connected-execution/sessions/{connected_session_id}/checkpoint:"));
assert(openapi.includes("/connected-execution/sessions/{connected_session_id}/evidence-reports:"));
assert(openapi.includes("/connected-execution/sessions/{connected_session_id}/resume-actions:"));
assert(openapi.includes("operationId: upsertConnectedExecutionSession"));
assert(openapi.includes("operationId: getConnectedExecutionLatestCheckpoint"));
assert(openapi.includes("operationId: createConnectedExecutionEvidenceReport"));
assert(openapi.includes("operationId: enqueueConnectedExecutionResumeAction"));

assert(runner.includes("187_sprint66_connected_execution_continuity_api_tools.sql"));
assert(readiness.includes("187_sprint66_connected_execution_continuity_api_tools.sql"));

console.log("connected execution continuity API contract tests passed");
