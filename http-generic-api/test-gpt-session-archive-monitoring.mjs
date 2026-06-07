import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/229_sprint67_gpt_session_archive_monitoring.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
const activationRoutes = readFileSync(new URL("./routes/activationRoutes.js", import.meta.url), "utf8");

assert.ok(migration.includes("CREATE OR REPLACE VIEW `v_gpt_session_archive_monitoring`"));
assert.ok(migration.includes("CREATE OR REPLACE VIEW `v_gpt_session_archive_monitoring_issues`"));
assert.ok(migration.includes("CREATE OR REPLACE VIEW `v_gpt_session_archive_monitoring_summary`"));
assert.ok(migration.includes("archive_write_failed"));
assert.ok(migration.includes("archive_ready_partial"));
assert.ok(migration.includes("missing_drive_jsonl"));
assert.ok(migration.includes("active_ref_without_primary"));
assert.ok(migration.includes("multiple_primary_refs"));
assert.ok(migration.includes("sparse_user_assistant_capture"));
assert.ok(migration.includes("missing_conversation_ref"));
assert.ok(migration.includes("secrets_included"));
assert.doesNotMatch(migration, /content_preview|`content`|\.content\b|\bcontent\s+AS\b/i, "monitoring views must not expose raw transcript text columns");
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.ok(runner.includes("229_sprint67_gpt_session_archive_monitoring.sql"));
assert.ok(readiness.includes("229_sprint67_gpt_session_archive_monitoring.sql"));
assert.ok(readiness.includes("checkGptSessionArchiveMonitoring"));
assert.ok(readiness.includes("v_gpt_session_archive_monitoring_summary"));
assert.ok(readiness.includes("v_gpt_session_archive_monitoring_issues"));
assert.ok(readiness.includes("gpt_session_archive_monitoring"));
assert.ok(readiness.includes("gpt_session_archive_fail_issue_rows"));
assert.ok(readiness.includes("gpt_session_archive_warn_issue_rows"));

assert.ok(activationRoutes.includes("conversation_ref_capture_policy"));
assert.ok(activationRoutes.includes('source_of_truth: "activation_session_context.current_session_id"'));
assert.ok(activationRoutes.includes("gpt_session_conversation_ref_mark_primary"));
assert.ok(activationRoutes.includes("browser_connector"));
assert.ok(activationRoutes.includes("browser_extension"));
assert.ok(activationRoutes.includes("never infer the session from recency"));
assert.ok(activationRoutes.includes("personal_urls_are_owner_private: true"));
assert.ok(activationRoutes.includes("superseded_by_ref_id"));

console.log("GPT session archive monitoring tests passed");
