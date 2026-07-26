import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const policyScript = readFileSync(new URL("./scripts/openrouter-model-policy.mjs", import.meta.url), "utf8");
const smokeScript = readFileSync(new URL("./scripts/openrouter-provider-smoke.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/217_sprint67_openrouter_model_policy_control.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(policyScript, /openrouter_model_selection_policy_v1/);
assert.match(policyScript, /SET_OPENROUTER_MODEL_POLICY/);
assert.match(policyScript, /openai\/gpt-4o-mini/);
assert.match(policyScript, /allowed_model_slugs/);
assert.match(policyScript, /openrouter_model_not_allowlisted/);
assert.match(policyScript, /allow_unlisted_runtime_override = false|allow_unlisted_runtime_override.*false/s);
assert.match(policyScript, /secrets_included: false/);
assert.doesNotMatch(policyScript, /OPENROUTER_API_KEY\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(policyScript, /sk-or-v1-[A-Za-z0-9_\-]+/i);

assert.match(smokeScript, /readModelPolicy/);
assert.match(smokeScript, /resolveSmokeModel/);
assert.match(smokeScript, /openrouter_model_selection_policy_v1/);
assert.match(smokeScript, /model_source/);
assert.match(smokeScript, /openrouter_model_not_allowlisted/);
assert.match(smokeScript, /selectedModel/);
assert.match(smokeScript, /secrets_included: false/);

assert.match(adminCli, /openrouter_model_policy/);
assert.match(adminCli, /scripts\/openrouter-model-policy\.mjs/);
assert.match(migration, /openrouter_model_selection_policy_v1/);
assert.match(migration, /openai\/gpt-4o-mini/);
assert.match(migration, /admin_platform_endpoint_tools/);
assert.match(migration, /dynamic_model_selection/);
assert.match(migration, /no_secrets/);
assert.match(runner, /217_sprint67_openrouter_model_policy_control\.sql/);

console.log("OpenRouter model policy control guard passed");
