import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const r7 = read(".github/workflows/hostinger-production-runtime-readback-r7.yml");
const exactCandidate = read(".github/workflows/production-promotion-exact-candidate-validation.yml");
const ci = read(".github/workflows/ci.yml");
const authRoutes = read("http-generic-api/routes/authRoutes.js");
const envExample = read("http-generic-api/.env.example");
const metadataRoutes = read("http-generic-api/routes/tenantGptOAuthMetadataRoutes.js");
const spec017Manifest = read("http-generic-api/scripts/manifests/test-manifest-spec017.mjs");

assert.match(r7, /push:\n\s+branches: \[Production\]/);
assert.match(r7, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/Production'/);
assert.match(r7, /expected_production_sha=\$\{EVENT_SHA\}/);
assert.match(r7, /expected_production_sha=\(\[0-9a-f\]\{40\}\)/);
assert.match(r7, /test "\$\{?remote_production_sha\}?" = "\$\{EXPECTED_PRODUCTION_SHA\}"/);
assert.match(r7, /version_sha_exact/);
assert.match(r7, /deployment_sha_exact/);
assert.match(r7, /branch_exact/);
assert.match(r7, /mcp-protected-resource/);
assert.match(r7, /https:\/\/mcp\.mad4b\.com\/\.well-known\/oauth-protected-resource/);
assert.match(r7, /https:\/\/auth\.mad4b\.com\/\.well-known\/oauth-authorization-server\/auth\/mcp/);
assert.doesNotMatch(r7, /fetch_mcp_initialize/);
assert.doesNotMatch(r7, /--request POST/);
assert.match(r7, /fetch_endpoint health/);
assert.match(r7, /fetch_endpoint mcp-protected-resource/);
assert.match(r7, /trusted_ingress_attestation_required/);
assert.match(r7, /oauth_discovery_not_ready/);
assert.match(r7, /const productionCurrent = identityHttpSuccess/);
assert.match(r7, /oauthDiscoveryReady/);
assert.match(r7, /public_get_only: true/);
assert.match(r7, /provider_mutation_performed: false/);
assert.match(r7, /deployment_performed: false/);
assert.match(r7, /database_mutation_performed: false/);
assert.match(r7, /secrets_included: false/);
assert.match(r7, /mad4b\.hostinger-production-runtime-readback-r7\.v1/);
assert.match(r7, /trigger_mode=production_push/);
assert.match(r7, /TRIGGER_MODE: \$\{\{ steps\.trigger\.outputs\.trigger_mode \}\}/);

assert.match(exactCandidate, /VALIDATE_EXACT_PRODUCTION_CANDIDATE/);
assert.match(exactCandidate, /expected_head_sha/);
assert.match(exactCandidate, /source-pinned refs moved/);
assert.match(exactCandidate, /candidate_tree_matches_base: true/);
assert.match(exactCandidate, /deployment_executed: false/);
assert.match(exactCandidate, /provider_call_executed: false/);
assert.match(exactCandidate, /credential_payload_read: false/);

assert.match(ci, /TENANT_GPT_SSO_SIGNING_SECRET/);
assert.match(authRoutes, /requireConfiguredSsoSigningSecret/);
assert.match(authRoutes, /at least 32 characters/);

assert.match(envExample, /^REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=false$/m);
assert.match(envExample, /^REMOTE_MCP_TRUSTED_INGRESS_ATTESTED=false$/m);
assert.match(envExample, /^REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS=false$/m);
assert.match(envExample, /three-part fail-closed Production contract/);
assert.match(metadataRoutes, /trustedIngressOrError/);
assert.match(metadataRoutes, /MCP_AUTHORIZATION_SERVER_NOT_FOUND/);
assert.match(metadataRoutes, /trusted_ingress: trustedIngress\.readiness/);
assert.match(spec017Manifest, /test-remote-mcp-production-trusted-ingress\.mjs/);

for (const workflow of [r7, exactCandidate]) {
  assert.doesNotMatch(workflow, /PRODUCTION_MUTATION_AUTHORIZED=true/);
  assert.doesNotMatch(workflow, /DATABASE_MUTATED=true/);
  assert.doesNotMatch(workflow, /MIGRATION_APPLIED=true/);
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.governed-autopilot-production-deployment.v2",
  exact_sha: true,
  source_pin_freshness: true,
  production_secret_startup_contract: true,
  trusted_ingress_contract: true,
  oauth_discovery_readback: true,
  post_deploy_r7_readback: true,
  bounded_failure_classification: true,
  provider_mutation: false,
  database_mutation: false,
  secrets_included: false,
}));
