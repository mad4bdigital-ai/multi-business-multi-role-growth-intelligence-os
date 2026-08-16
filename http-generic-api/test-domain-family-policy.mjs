import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const policy = JSON.parse(read("http-generic-api/config/domain-family-policy.json"));
const deployment = JSON.parse(read("http-generic-api/config/deployment-branch-policy.json"));
const env = read("http-generic-api/.env.staging.example");
const compose = parse(read("http-generic-api/docker-compose.staging.yml"));
const activationPolicy = JSON.parse(read("http-generic-api/activation-gateway-runtime/generated/route-policy.json"));
const activationGatewaySource = read("http-generic-api/activation-gateway-runtime/src/gateway.mjs");
const ssoSessionSource = read("http-generic-api/tenantGptSsoSession.js");

assert.equal(policy.enforcement_mode, "fail_closed");
assert.equal(policy.routing_authority.staging_ingress_source_of_truth, "cloudflare_remote_tunnel_configuration");
assert.equal(policy.routing_authority.staging_env_hostname_role, "declaration_only");
assert.equal(policy.routing_authority.staging_origin_source_of_truth, "docker_compose_app_service");
assert.equal(policy.routing_authority.provider_mutation_required_to_activate, true);
assert.equal(policy.routing_authority.mismatch_action, "deny_and_do_not_fallback");
assert.deepEqual(policy.default_route, {
  action: "http_status",
  status: 404,
  reason: "unmatched_hostname_is_not_routable",
});

const production = Object.values(policy.environments.production.hostnames);
const staging = Object.values(policy.environments.staging.hostnames);
const productionNames = production.map((entry) => entry.hostname);
const stagingNames = staging.map((entry) => entry.hostname);
assert.deepEqual(productionNames, ["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com"]);
assert.deepEqual(stagingNames, ["dev.mad4b.com", "mcp_dev.mad4b.com", "activation_dev.mad4b.com"]);
assert.equal(new Set([...productionNames, ...stagingNames]).size, 6);
assert.equal(production.some((entry) => entry.origin_kind !== "hostinger_production"), false);
assert.equal(staging.some((entry) => entry.origin_kind !== "local_staging_app"), false);
assert.equal(policy.environments.staging.hostnames.auth.exposure_status, "active_opt_in");
assert.equal(policy.environments.staging.hostnames.auth.required_runtime_flag, "TENANT_GPT_STAGING_ENABLED=true");
assert.equal(policy.environments.staging.hostnames.mcp.exposure_status, "active_opt_in");
assert.equal(policy.environments.staging.hostnames.mcp.required_runtime_flag, "REMOTE_MCP_ENABLED=true and REMOTE_MCP_OAUTH_ENABLED=true");
assert.equal(policy.environments.staging.hostnames.activation.exposure_status, "active_opt_in");
assert.equal(policy.environments.staging.hostnames.activation.required_runtime_bundle, "dedicated_staging_activation_gateway_bundle");
assert.equal(policy.environments.staging.hostnames.activation.required_runtime_flag, "ACTIVATION_STAGING_GATEWAY_ENABLED=true");
assert.equal(policy.environments.production.tunnel_enabled, false);
assert.equal(policy.environments.staging.tunnel_enabled, true);
assert.deepEqual(policy.environments.staging.active_tunnel_hostnames, ["dev.mad4b.com", "mcp_dev.mad4b.com", "activation_dev.mad4b.com"]);
assert.deepEqual(policy.environments.staging.reserved_disabled_hostnames, []);
assert.notEqual(policy.environments.production.credential_namespace, policy.environments.staging.credential_namespace);

assert.deepEqual(deployment.production.hostnames, productionNames);
assert.deepEqual(deployment.staging.hostnames, stagingNames);
assert.equal(deployment.connector_recovery.excluded_from_hostname_families, true);

for (const hostname of productionNames) assert.equal(env.includes(hostname), false, `staging env must not contain Production hostname ${hostname}`);
assert.match(env, /CLOUDFLARE_TUNNEL_ENVIRONMENT=staging/);
assert.match(env, /CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp_dev\.mad4b\.com,activation_dev\.mad4b\.com\s*$/m);
assert.match(env, /ACTIVATION_STAGING_GATEWAY_ENABLED=false/);
assert.match(env, /REMOTE_MCP_ENABLED=true/);
assert.match(env, /REMOTE_MCP_OAUTH_ENABLED=true/);
assert.match(env, /CLOUDFLARE_TUNNEL_ORIGIN_APP=http:\/\/app:8080/);
assert.match(env, /CLOUDFLARE_TUNNEL_TOKEN=\s*$/m);
assert.match(env, /TENANT_GPT_SSO_COOKIE_MODE=host_only/);
assert.match(env, /TENANT_GPT_SSO_TRUST_BOUNDARY_ATTESTED=false/);
assert.match(env, /MIGRATION_APPLIED=false/);
assert.match(env, /DATABASE_MUTATED=false/);

const tunnel = compose.services.cloudflared;
assert.deepEqual(tunnel.profiles, ["tunnel"]);
assert.match(String(tunnel.command), /--token/);
assert.equal(String(tunnel.environment.TUNNEL_ENVIRONMENT), "${CLOUDFLARE_TUNNEL_ENVIRONMENT:-staging}");
assert.equal(String(tunnel.environment.TUNNEL_ORIGIN_APP), "${CLOUDFLARE_TUNNEL_ORIGIN_APP:-http://app:8080}");
assert.equal(String(tunnel.environment.TUNNEL_HOSTNAMES), "${CLOUDFLARE_TUNNEL_HOSTNAMES:-dev.mad4b.com,mcp_dev.mad4b.com,activation_dev.mad4b.com}");

// The edge bundle remains Production-only; local Staging activation is gated by
// its own opt-in runtime flag and dedicated OpenAPI/OAuth bundle.
assert.equal(activationPolicy.public_host, "activation.mad4b.com");
assert.equal(activationPolicy.upstream_origin, "https://auth.mad4b.com");
assert.equal(activationPolicy.public_host === "activation_dev.mad4b.com", false);
assert.match(activationGatewaySource, /GATEWAY_HOST_MISMATCH/);
assert.match(ssoSessionSource, /TENANT_GPT_SSO_COOKIE_MODE_HOST_ONLY/);
assert.match(ssoSessionSource, /domain: mode === TENANT_GPT_SSO_COOKIE_MODE_SHARED \? ".mad4b\.com" : null/);
assert.match(env, /TENANT_GPT_SSO_COOKIE_MODE=host_only/);

console.log("domain_family_policy=PASS");
