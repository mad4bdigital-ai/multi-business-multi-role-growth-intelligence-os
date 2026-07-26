import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("routes/gptToolsRoutes.js", "utf8");
const migration = fs.readFileSync("migrations/20260627_activation_gateway_rollout_surface.sql", "utf8");
const moduleSource = fs.readFileSync("activationGatewayRolloutTool.js", "utf8");

for (const tool of ["activation_gateway_rollout_plan", "activation_gateway_dark_deploy"]) {
  assert.match(routes, new RegExp(`name: \\"${tool}\\"`));
  assert.match(routes, new RegExp(`toolKey === \\"${tool}\\"`));
  assert.match(migration, new RegExp(tool));
}

assert.match(routes, /activation_gateway_rollout_plan[\s\S]*read_only[\s\S]*no_external_write[\s\S]*no_dns[\s\S]*no_custom_domain/);
assert.match(routes, /activation_gateway_dark_deploy[\s\S]*dry_run_default_true[\s\S]*typed_confirmation[\s\S]*capability_envelope[\s\S]*rollback_required/);
assert.match(routes, /activation_gateway_dark_deploy[\s\S]*execution_nonce[\s\S]*minLength: 8[\s\S]*maxLength: 128/);
assert.match(routes, /additionalProperties: false/);
assert.doesNotMatch(routes, /ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON[\s\S]*inputSchema/);
assert.doesNotMatch(routes, /ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK[\s\S]*inputSchema/);

assert.match(migration, /activation_gateway_dark_deploy_authority_v1/);
assert.match(migration, /activation_gateway_dark_deploy_apply_policy_v1/);
assert.match(migration, /activation_gateway_dark_deploy_v1/);
assert.match(migration, /8be421f5-49d3-4bda-a0f6-3cf8a04ee227/);
assert.match(migration, /cloudflare:\/\/accounts\/dd1024b934e907723484568d97c7c74c\/workers\/scripts\/mad4b-activation-gateway/);
assert.match(migration, /'dns_write_allowed', FALSE/);
assert.match(migration, /'custom_domain_binding_allowed', FALSE/);
assert.match(migration, /'workers_dev_only', TRUE/);
assert.match(migration, /'single_use_envelope_required', TRUE/);
assert.match(migration, /'execution_nonce_required', TRUE/);
assert.match(migration, /Generic admin_cloudflare and Cloudflare DNS writes remain uncertified and blocked/);
assert.doesNotMatch(migration, /UPDATE\s+runtime_dispatch_certification_registry[\s\S]*certification_key\s*=\s*'admin_cloudflare_v1'/i);
assert.doesNotMatch(migration, /dns_records/i);

assert.match(moduleSource, /ACTIVATION_GATEWAY_DARK_DEPLOY_ENABLED/);
assert.match(moduleSource, /resolveCapabilityExecutionEnvelope/);
assert.match(moduleSource, /activation_gateway_capability_envelope_replay_blocked/);
assert.match(moduleSource, /execution_status='referenced'/);
assert.match(moduleSource, /execution_nonce_sha256/);
assert.match(moduleSource, /activation_gateway_typed_confirmation_mismatch/);
assert.match(moduleSource, /rollbackActivationGateway/);
assert.match(moduleSource, /health_policy_hash_matches/);
assert.match(moduleSource, /ready_policy_hash_matches/);
assert.match(moduleSource, /activation_gateway_dns_not_allowed/);
assert.match(moduleSource, /secrets_included: false/);
assert.doesNotMatch(moduleSource, /api\.cloudflare\.com\/client\/v4\/zones/);

console.log("Activation Gateway rollout surface contract tests passed.");
