import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/220_sprint67_codex_dual_mode_policy.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(migration, /tenant_codex_dual_mode_policy_v1/);
assert.match(migration, /codex_chatgpt_oauth/);
assert.match(migration, /codex_openrouter_custom_provider/);
assert.match(migration, /user_owned_local_chatgpt_oauth/);
assert.match(migration, /platform_managed_fallback/);
assert.match(migration, /uses_user_chatgpt_plan/);
assert.match(migration, /requires_user_codex_login/);
assert.match(migration, /requires_local_manager_device/);
assert.match(migration, /openrouter_openai_compatible/);
assert.match(migration, /openrouter_model_selection_policy_v1/);
assert.match(migration, /requires_quota_budget/);
assert.match(migration, /requires_audit_log/);
assert.match(migration, /requires_user_disclosure/);
assert.match(migration, /server_side_shared_admin_oauth_allowed',false/);
assert.match(migration, /copy_platform_secret_to_device',false/);
assert.match(migration, /return_provider_api_key_to_agent',false/);
assert.match(migration, /secrets_included',false/);
assert.match(migration, /enterprise_workspace_or_api_org/);
assert.match(runner, /220_sprint67_codex_dual_mode_policy\.sql/);

assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(migration, /CODEX_ACCESS_TOKEN\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(migration, /sk-[A-Za-z0-9_\-]{12,}/i);
assert.doesNotMatch(migration, /server_side_shared_admin_oauth_allowed',true/);
assert.doesNotMatch(migration, /copy_platform_secret_to_device',true/);
assert.doesNotMatch(migration, /return_user_oauth_token_to_platform',true/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

console.log("Codex dual-mode tenant policy guard passed");
