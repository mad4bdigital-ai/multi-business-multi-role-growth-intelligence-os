import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/218_sprint67_activate_openclaude_openrouter_provider.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(migration, /openclaude_openrouter_openai_compatible/);
assert.match(migration, /openclaude_essam_openrouter_bridge_v1/);
assert.match(migration, /openrouter_openai_compatible/);
assert.match(migration, /openrouter_model_selection_policy_v1/);
assert.match(migration, /docs_agent_openrouter_instruction_contract_v1/);
assert.match(migration, /active_live_provider_dispatch_smoke_passed/);
assert.match(migration, /copy_platform_secret_to_device['"]?,\s*false/);
assert.match(migration, /return_provider_api_key_to_agent['"]?,\s*false/);
assert.match(migration, /repo_mutation_allowed['"]?,\s*false/);
assert.match(migration, /secrets_included['"]?,\s*false/);
assert.match(migration, /JSON_ARRAY\('Read','Grep','Glob','LS'\)/);
assert.match(migration, /JSON_ARRAY\('Edit','Write','MultiEdit','NotebookEdit','Bash','git push','git commit','apply_patch'\)/);
assert.match(migration, /EXISTS \(SELECT 1 FROM ai_model_providers WHERE provider_key='openrouter_openai_compatible' AND status='active' AND secrets_returned_to_agent=0\)/);
assert.match(migration, /openai\/gpt-4o-mini/);
assert.match(runner, /218_sprint67_activate_openclaude_openrouter_provider\.sql/);

assert.doesNotMatch(migration, /OPENROUTER_API_KEY\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(migration, /sk-or-v1-[A-Za-z0-9_\-]+/i);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /copy_platform_secret_to_device['"]?,\s*true/);
assert.doesNotMatch(migration, /repo_mutation_allowed['"]?,\s*true/);

console.log("OpenClaude OpenRouter activation migration guard passed");
