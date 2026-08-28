import assert from "node:assert/strict";
import { resolveActivationGatewayHostProfile } from "./activationGatewayHostProfile.js";
import { resolveRuntimeEnvironment } from "./runtimeEnvironmentResolver.js";

const stagingLocal = {
  NODE_ENV: "staging",
  REMOTE_MCP_ENVIRONMENT: "staging",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
};
const staging = resolveActivationGatewayHostProfile(stagingLocal);
assert.equal(staging.ok, true);
assert.equal(staging.runtime.environment_key, "staging");
assert.equal(staging.runtime.runtime_class, "local_windows_docker");
assert.equal(staging.runtime.branch, "main");
assert.equal(staging.runtime.authority_mode, "non_live");
assert.equal(staging.profile.gateway_key, "activation_gateway_staging");
assert.equal(staging.profile.public_host, "activation-dev.mad4b.com");
assert.equal(staging.profile.upstream_host, "dev.mad4b.com");
assert.equal(staging.profile.oauth_issuer_host, "dev.mad4b.com");
assert.equal(staging.profile.resource_origin, "https://activation-dev.mad4b.com");

const stagingHosted = resolveActivationGatewayHostProfile({
  NODE_ENV: "staging",
  REMOTE_MCP_ENVIRONMENT: "staging",
});
assert.equal(stagingHosted.ok, true);
assert.equal(stagingHosted.runtime.runtime_class, "staging_hosted");

const production = resolveActivationGatewayHostProfile({
  NODE_ENV: "production",
  REMOTE_MCP_ENVIRONMENT: "production",
  DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy",
});
assert.equal(production.ok, true);
assert.equal(production.runtime.runtime_class, "hostinger_autodeploy");
assert.equal(production.runtime.branch, "Production");
assert.equal(production.profile.gateway_key, "activation_gateway_production");
assert.equal(production.profile.public_host, "activation.mad4b.com");
assert.equal(production.profile.upstream_host, "auth.mad4b.com");
assert.equal(production.profile.oauth_issuer_host, "auth.mad4b.com");
assert.equal(production.runtime.authority_mode, "production_live_or_disabled");

const unknown = resolveRuntimeEnvironment({ NODE_ENV: "mystery" });
assert.equal(unknown.ok, false);
assert.equal(unknown.reason, "runtime_environment_unknown");
assert.equal(resolveActivationGatewayHostProfile({ NODE_ENV: "mystery" }).ok, false);

const conflicting = resolveRuntimeEnvironment({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "production" });
assert.equal(conflicting.ok, false);
assert.equal(conflicting.reason, "runtime_environment_conflict");
assert.equal(resolveActivationGatewayHostProfile({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "production" }).ok, false);

const publicHostConflict = resolveActivationGatewayHostProfile({
  NODE_ENV: "staging",
  ACTIVATION_HOST_GATEWAY_HOST: "dev.mad4b.com",
});
assert.equal(publicHostConflict.ok, false);
assert.equal(publicHostConflict.reason, "activation_gateway_public_host_conflict");

const upstreamConflict = resolveActivationGatewayHostProfile({
  NODE_ENV: "staging",
  ACTIVATION_STAGING_UPSTREAM_HOST: "auth.mad4b.com",
});
assert.equal(upstreamConflict.ok, false);
assert.equal(upstreamConflict.reason, "activation_gateway_upstream_host_conflict");

console.log("activation_gateway_host_profile=PASS");
