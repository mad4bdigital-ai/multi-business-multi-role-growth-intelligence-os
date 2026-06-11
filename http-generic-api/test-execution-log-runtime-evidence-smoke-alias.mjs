import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/execution-log-runtime-evidence-smoke.mjs", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

for (const token of [
  "writeExecutionEvidence",
  "execution_log_runtime_evidence_smoke",
  "execution_evidence_status === \"complete\"",
  "tenant_admin,operator",
  "execution_log_runtime_evidence_policy_v1",
  "platform_resource_authority_binding_policy_v1",
  "activation_smoke_agent",
  "activation_smoke_skill",
  "activation_smoke_app",
  "activation_smoke_workflow",
  "activation_smoke_workflow_binding",
  "blocked_field_leak_detected",
  "external_provider_called: false",
  "secrets_included: false",
]) assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

for (const blocked of [
  "credential_ref",
  "value_ciphertext",
  "secret_value",
  "token_value",
  "password",
  "private_key",
  "config_json",
  "capability_json",
  "encrypted_credentials",
  "webhook_url",
  "n8n_webhook_url",
  "system_prompt",
  "prompt_template",
  "manifest_json",
  "tool_manifest_json",
  "input_schema_json",
  "output_schema_json",
]) assert.match(script, new RegExp(blocked));

assert.match(routes, /execution_log_runtime_evidence_smoke/);
assert.match(routes, /scripts\/execution-log-runtime-evidence-smoke\.mjs/);
assert.match(routes, /allow_extra_args:\s*false/);
assert.match(routes, /timeout_ms:\s*120000/);
assert.doesNotMatch(script, /process\.env\.[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|KEY)/i);

console.log("execution log runtime evidence smoke alias guard passed");
