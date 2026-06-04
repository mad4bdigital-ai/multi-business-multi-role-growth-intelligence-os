import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/jobRoutes.js", "utf8");
const index = readFileSync("routes/index.js", "utf8");
const server = readFileSync("server.js", "utf8");
const migration = readFileSync("migrations/192_sprint66_execution_job_tick_admin_tool.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const readiness = readFileSync("releaseReadiness.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const docs = readFileSync("../docs/execution-job-tick-admin-2026-06-04.md", "utf8");

assert(routes.includes('router.post("/jobs/:jobId/tick"'), "manual tick route must exist");
assert(routes.includes("requireBackendApiKey"), "manual tick route must require backend auth");
assert(routes.includes("requireAdminPrincipal"), "manual tick route must require admin principal guard");
assert(routes.includes("executeSingleQueuedJob(job)"), "manual tick must use the same queued job runner");
assert(routes.includes('beforeStatus !== "queued"'), "manual tick must only process queued jobs");
assert(routes.includes("job_not_queued"), "manual tick must reject non-queued jobs");
assert(routes.includes("job_not_found"), "manual tick must handle missing jobs");
assert(routes.includes("job_tick_unavailable"), "manual tick must report unavailable dependencies");
assert(routes.includes("secrets_included: false"), "manual tick responses must be no-secret");
assert(!routes.includes("jobQueue.add"), "manual tick route must not create new queue jobs");
assert(!routes.includes("setInterval"), "manual tick route must not become a scheduler");

assert(index.includes("buildJobRoutes({ ...deps, requireAdminPrincipal })"), "job routes must receive the admin principal guard");
assert(server.includes("executeSingleQueuedJob"), "server must expose queued job runner dependency");
assert(server.includes("toJobSummary"), "server must expose job summary dependency");

assert(migration.includes("execution_job_tick_admin"), "migration must register admin tool");
assert(migration.includes("execution_job_tick_admin_v1"), "migration must register certification");
assert(migration.includes("one_job_only"), "migration must tag one-job guardrail");
assert(migration.includes("requires_queued_status"), "migration must tag queued-status requirement");
assert(migration.includes("no_new_capability"), "migration must tag no-new-capability guardrail");
assert(!/DROP\s+/i.test(migration));
assert(!/DELETE\s+/i.test(migration));
assert(!/TRUNCATE\s+/i.test(migration));
assert(!/CAST\s*\(\s*\?\s+AS\s+JSON\s*\)/i.test(migration));

assert(runner.includes("192_sprint66_execution_job_tick_admin_tool.sql"), "migration 192 must be runner allowlisted");
assert(readiness.includes("192_sprint66_execution_job_tick_admin_tool.sql"), "migration 192 must be release readiness expected");
assert(openapi.includes("operationId: tickExecutionJobAdmin"), "OpenAPI must document manual tick operation");
assert(openapi.includes("JobTickResponse"), "OpenAPI must include tick response schema");
assert(openapi.includes("/jobs/{job_id}/tick"), "OpenAPI must document tick path");
assert(docs.includes("one queued job only") || docs.includes("one queued job"), "docs must describe one-job scope");

console.log("execution job tick admin contract tests passed");
