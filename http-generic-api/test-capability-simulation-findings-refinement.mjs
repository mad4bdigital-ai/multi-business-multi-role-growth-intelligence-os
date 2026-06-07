import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/capability-resolution-simulation-suite.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/224_sprint67_capability_simulation_findings_refinement.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /fallbackGateRequired/);
assert.match(script, /platform_fallback_secondary_only/);
assert.match(script, /requiresUserDisclosure/);
assert.match(script, /gates\.requires_user_disclosure/);
assert.match(script, /gates\.user_disclosure_required/);
assert.doesNotMatch(script, /decryptToken|value_ciphertext|private_key|oauth_token/i);
assert.doesNotMatch(script, /fetch\(|axios|child_process|exec\(|spawn\(/);

assert.match(migration, /Refine capability simulation findings after first live run/);
assert.match(migration, /codex_chatgpt_oauth/);
assert.match(migration, /codex_openrouter_custom_provider/);
assert.match(migration, /app_integrations/);
assert.match(migration, /platform_fallback_secondary_only/);
assert.match(migration, /requires_quota/);
assert.match(migration, /requires_audit_log/);
assert.match(migration, /requires_user_disclosure/);
assert.match(migration, /copy_user_oauth_token_to_platform',false/);
assert.match(migration, /copy_platform_secret_to_device',false/);
assert.match(migration, /return_provider_api_key_to_agent',false/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.match(runner, /224_sprint67_capability_simulation_findings_refinement\.sql/);

console.log("Capability simulation findings refinement guard passed");
