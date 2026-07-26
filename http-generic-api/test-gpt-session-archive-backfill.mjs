import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backfillGptSessionArchiveFromJsonl } from "./sessionArchiveService.js";

assert.equal(typeof backfillGptSessionArchiveFromJsonl, "function", "JSONL backfill service must be exported");

const service = readFileSync("sessionArchiveService.js", "utf8");
const routes = readFileSync("routes/releaseRoutes.js", "utf8");
const migration = readFileSync("migrations/246_sprint68_gpt_session_archive_backfill_tool.sql", "utf8");
const mutationPolicyMigration = readFileSync("migrations/1027_sprint69_gpt_session_archive_backfill_mutation_policy.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const readiness = readFileSync("releaseReadiness.js", "utf8");

assert(service.includes("gpt_session_archive_backfill"), "backfill service must write an archive backfill event");
assert(service.includes("previous_drive_doc_id"), "backfill must preserve the old Drive doc pointer in evidence");
assert(service.includes("backfilled_from_jsonl"), "backfill evidence must identify JSONL source");
assert(service.includes("secrets_included: false"), "backfill service must declare no-secret payloads");
assert(service.includes("record_count"), "backfill result must include rebuilt JSONL record count");

assert(routes.includes("/release/session-archive-backfill"), "release route must expose session archive backfill");
assert(routes.includes("dry_run !== false"), "backfill route must default to dry-run");
assert(routes.includes("LIMIT ${limit}"), "backfill route must bound implicit candidate selection");
assert(routes.includes("gpt_session_archive_backfill"), "backfill route must skip already-backfilled sessions");

assert(migration.includes("gpt_session_archive_backfill"), "admin tool migration must register backfill tool");
assert(migration.includes("dry_run_default_true"), "backfill tool must advertise dry-run default");
assert(migration.includes("NOT EXISTS"), "monitoring issue view must suppress already-backfilled sparse warnings");
assert(migration.includes("session_events"), "backfill marker should be session_events-based, not raw content-based");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE/i.test(migration), "migration must not include destructive table operations");
assert(mutationPolicyMigration.includes("dry_run_default"), "apply-capable backfill descriptor must declare dry-run mutation policy");
assert(mutationPolicyMigration.includes("readback"), "apply-capable backfill descriptor must declare readback policy");
assert(mutationPolicyMigration.includes("gpt_session_archive_backfill"), "descriptor repair must target the backfill tool only");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(mutationPolicyMigration), "descriptor repair must remain metadata-only and non-destructive");

assert(runner.includes("246_sprint68_gpt_session_archive_backfill_tool.sql"), "governed runner must allow backfill migration");
assert(readiness.includes("246_sprint68_gpt_session_archive_backfill_tool.sql"), "release readiness must track backfill migration");

console.log("GPT session archive backfill tests passed");
