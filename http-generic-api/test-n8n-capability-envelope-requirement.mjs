import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const proxy = readFileSync(new URL("./routes/connectorProxyRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/228_sprint67_n8n_capability_envelope_requirement.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(proxy, /N8N_ENVELOPE_REQUIRED_ACTIONS/);
assert.match(proxy, /activate_workflow/);
assert.match(proxy, /deactivate_workflow/);
assert.match(proxy, /run_workflow/);
assert.match(proxy, /resolveCapabilityExecutionEnvelope/);
assert.match(proxy, /acceptedAppKeys: \["n8n"\]/);
assert.match(proxy, /markCapabilityEnvelopeReferenced/);
assert.match(proxy, /connector_forwarded: false/);
assert.match(proxy, /secrets_included: false/);
assert.doesNotMatch(proxy, /decryptToken\(|value_ciphertext|oauth_token|private_key/i);

const gateIndex = proxy.indexOf("await requireN8nCapabilityEnvelopeIfStateChanging");
const forwardOptionsIndex = proxy.indexOf("const baseOptions = await buildForwardOptions");
const apiBridgeIndex = proxy.indexOf("forwardedBody._platform_n8n_api_key");
assert.ok(gateIndex > -1, "n8n proxy must validate capability envelope for state-changing actions.");
assert.ok(forwardOptionsIndex > gateIndex, "n8n envelope gate must run before buildForwardOptions.");
assert.ok(apiBridgeIndex > -1, "n8n API bridge remains explicit and test-visible.");

assert.match(migration, /n8n_state_changing_capability_envelope_requirement_v1/);
assert.match(migration, /state_changing_actions_require_envelope/);
assert.match(migration, /read_only_actions_do_not_require_envelope/);
assert.match(migration, /connector_forwarding_blocked_without_envelope/);
assert.match(migration, /api_key_bridge_occurs_after_envelope_gate/);
assert.match(migration, /capability_envelope_required_for_state_change/);
assert.match(migration, /JSON_SET\(input_schema/);
assert.doesNotMatch(migration, /request_schema_json|approval_policy_json/);
const tenantUpdateBlock = migration.match(/UPDATE tenant_platform_endpoint_tools[\s\S]*?;\n/)?.[0] || "";
assert.match(tenantUpdateBlock, /UPDATE tenant_platform_endpoint_tools/);
assert.doesNotMatch(tenantUpdateBlock, /updated_at = CURRENT_TIMESTAMP/);
assert.match(migration, /secrets_included',false/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /OPENAI_API_KEY\s*[:=]|OPENROUTER_API_KEY\s*[:=]|N8N_API_KEY\s*[:=]|sk-[A-Za-z0-9_\-]{12,}/i);
assert.match(runner, /228_sprint67_n8n_capability_envelope_requirement\.sql/);

console.log("n8n capability envelope requirement guard passed");
