import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("./routes/gptSessionRoutes.js", import.meta.url), "utf8");
const gptToolsRoutes = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const activationRoutes = readFileSync(new URL("./routes/activationRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/219_sprint67_gpt_session_turn_batch_write_tool.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert.ok(routes.includes('router.post("/gpt/sessions/:id/turns"'));
assert.ok(routes.includes("MAX_BATCH_TURNS = 20"));
assert.ok(routes.includes("validateTurnInput"));
assert.ok(routes.includes("resolveWritableSession"));
assert.ok(routes.includes("nextTurnIndex"));
assert.ok(routes.includes("recordGptSessionTurn"));
assert.ok(routes.includes("intended_use"));
assert.ok(routes.includes("preview_hash_only"));
assert.ok(routes.includes("drive_doc_and_jsonl"));
assert.ok(routes.includes("secrets_included: false"));
assert.match(routes, /for \(const turn of normalizedTurns\)[\s\S]+turnIndex \+= 1/);
assert.ok(!routes.includes("content_rows"));

assert.ok(activationRoutes.includes("turn_capture_policy"));
assert.ok(activationRoutes.includes("required_for_full_transcript"));
assert.ok(activationRoutes.includes("gpt_session_turns_write_batch"));
assert.ok(activationRoutes.includes("After each conversational exchange"));
assert.ok(activationRoutes.includes("drive_doc_and_jsonl"));
assert.ok(activationRoutes.includes("current_session_id: newSessionId"));
assert.ok(activationRoutes.includes("secrets_included: false"));

assert.ok(migration.includes("gpt_session_turns_write_batch"));
assert.ok(migration.includes("/gpt/sessions/{id}/turns"));
assert.ok(migration.includes("minItems"));
assert.ok(migration.includes("maxItems"));
assert.ok(migration.includes("no_secrets"));
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.ok(runner.includes("219_sprint67_gpt_session_turn_batch_write_tool.sql"));
assert.ok(readiness.includes("219_sprint67_gpt_session_turn_batch_write_tool.sql"));
assert.ok(readiness.includes("gpt_session_turns_write_batch"));

console.log("GPT session turn batch capture tests passed");
