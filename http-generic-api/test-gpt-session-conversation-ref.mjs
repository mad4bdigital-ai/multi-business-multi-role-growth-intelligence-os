import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("./routes/gptSessionRoutes.js", import.meta.url), "utf8");
const activationRoutes = readFileSync(new URL("./routes/activationRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/223_sprint67_gpt_session_conversation_refs.sql", import.meta.url), "utf8");
const primaryMigration = readFileSync(new URL("./migrations/225_sprint67_gpt_session_conversation_ref_primary.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");

assert.ok(routes.includes("CHATGPT_INTERFACES"));
assert.ok(routes.includes("g-69c82c73bd6081918c52e38525b2d154"));
assert.ok(routes.includes("growth-intelligence-platform-admin-assistant"));
assert.ok(routes.includes("g-69b6e4de8fd88191ac132362e1ee300e"));
assert.ok(routes.includes("mad4b-growth-intelligence-tenant"));
assert.ok(routes.includes('router.post("/gpt/sessions/:id/conversation-ref"'));
assert.ok(routes.includes('router.post("/gpt/sessions/:id/conversation-ref/mark-primary"'));
assert.ok(routes.includes("parseChatGptUrl"));
assert.ok(routes.includes("personal_conversation_url"));
assert.ok(routes.includes("share_url"));
assert.ok(routes.includes("admin_custom_gpt"));
assert.ok(routes.includes("tenant_custom_gpt"));
assert.ok(routes.includes("visibility_note"));
assert.ok(routes.includes("is_primary"));
assert.ok(routes.includes("superseded_by_ref_id"));
assert.ok(routes.includes("superseded_at"));
assert.ok(routes.includes("conversation_ref_primary_failed"));
assert.ok(routes.includes('source_of_truth: "activation_session_context.current_session_id"'));
assert.ok(routes.includes("old_session_refs_for_same_chatgpt_conversation"));
assert.ok(routes.includes("secrets_included: false"));
assert.ok(routes.includes("Only chatgpt.com conversation URLs are supported"));
assert.ok(routes.includes("Personal ChatGPT conversation URLs are private"));

assert.ok(activationRoutes.includes("gpt_session_conversation_refs"));
assert.ok(activationRoutes.includes("chatgpt_conversation_refs"));
assert.ok(activationRoutes.includes("personal_conversation_url"));
assert.ok(activationRoutes.includes("share_url"));
assert.ok(activationRoutes.includes("interface_scope"));

assert.ok(migration.includes("CREATE TABLE IF NOT EXISTS `gpt_session_conversation_refs`"));
assert.ok(migration.includes("personal_conversation_url"));
assert.ok(migration.includes("share_url"));
assert.ok(migration.includes("interface_scope"));
assert.ok(migration.includes("gpt_session_conversation_ref_upsert"));
assert.ok(migration.includes("admin_platform_endpoint_tools"));
assert.ok(migration.includes("tenant_platform_endpoint_tools"));
assert.ok(migration.includes("g-69b6e4de8fd88191ac132362e1ee300e"));
assert.ok(migration.includes("admin_custom_gpt"));
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.ok(primaryMigration.includes("ADD COLUMN IF NOT EXISTS `is_primary`"));
assert.ok(primaryMigration.includes("superseded_by_ref_id"));
assert.ok(primaryMigration.includes("gpt_session_conversation_ref_mark_primary"));
assert.ok(primaryMigration.includes("/gpt/sessions/{id}/conversation-ref/mark-primary"));
assert.ok(primaryMigration.includes("tenant_platform_endpoint_tools"));
assert.doesNotMatch(primaryMigration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.ok(runner.includes("223_sprint67_gpt_session_conversation_refs.sql"));
assert.ok(runner.includes("225_sprint67_gpt_session_conversation_ref_primary.sql"));
assert.ok(readiness.includes("223_sprint67_gpt_session_conversation_refs.sql"));
assert.ok(readiness.includes("225_sprint67_gpt_session_conversation_ref_primary.sql"));
assert.ok(readiness.includes("gpt_session_conversation_ref_upsert"));
assert.ok(readiness.includes("gpt_session_conversation_ref_mark_primary"));

console.log("GPT session conversation reference tests passed");
