import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/supervisor-causal-provider-certification.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/1008_sprint69_supervisor_causal_provider_certification_tool.sql", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /runOpenClaudeOpenRouterLiveDispatch/);
assert.match(script, /INSERT INTO execution_plans/);
assert.match(script, /INSERT INTO workflow_runs/);
assert.match(script, /writeExecutionEvidence/);
assert.match(script, /causal_provider_certified/);
assert.match(script, /SUPERVISOR_CAUSAL_PROVIDER_OK/);
assert.match(script, /tool_call_count !== 0/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /value_ciphertext|OPENROUTER_API_KEY/i);
assert.match(migration, /supervisor_causal_provider_certification/);
assert.match(migration, /requires_confirmation/);
assert.match(routes, /supervisor_causal_provider_certification/);

console.log("supervisor causal provider certification contracts passed");
