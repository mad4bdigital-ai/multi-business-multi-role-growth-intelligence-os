import assert from "node:assert/strict";
import {
  isProductionRuntime,
  isStagingRuntime,
  resolveRuntimeEnvironment,
} from "./runtimeEnvironmentResolver.js";

const staging = resolveRuntimeEnvironment({ NODE_ENV: "staging", REMOTE_MCP_ENVIRONMENT: "staging" });
assert.equal(staging.ok, true);
assert.equal(staging.environment_key, "staging");
assert.equal(staging.runtime_variant, "staging");
assert.equal(isStagingRuntime({ NODE_ENV: "staging", REMOTE_MCP_ENVIRONMENT: "staging" }), true);

const docker = resolveRuntimeEnvironment({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker" });
assert.equal(docker.ok, true);
assert.equal(docker.environment_key, "staging");
assert.equal(docker.runtime_variant, "staging_local_windows_docker");
assert.equal(resolveRuntimeEnvironment({ DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker", REMOTE_MCP_ENVIRONMENT: "staging_hosted" }).reason, "runtime_class_conflict");
assert.equal(resolveRuntimeEnvironment({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "staging_hosted" }).runtime_class, "staging_hosted");

const production = resolveRuntimeEnvironment({ NODE_ENV: "production", DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy" });
assert.equal(production.ok, true);
assert.equal(production.environment_key, "production");
assert.equal(isProductionRuntime({ NODE_ENV: "production" }), true);

const unknown = resolveRuntimeEnvironment({ NODE_ENV: "staging-blue" });
assert.equal(unknown.ok, false);
assert.equal(unknown.reason, "runtime_environment_unknown");

const conflict = resolveRuntimeEnvironment({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "production" });
assert.equal(conflict.ok, false);
assert.equal(conflict.reason, "runtime_environment_conflict");
assert.equal(isStagingRuntime({ NODE_ENV: "staging", DEPLOYMENT_ENVIRONMENT: "production" }), false);

const missing = resolveRuntimeEnvironment({});
assert.equal(missing.ok, false);
assert.equal(missing.reason, "runtime_environment_missing");

console.log("runtime_environment_resolver=PASS");
