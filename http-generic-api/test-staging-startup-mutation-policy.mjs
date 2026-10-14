import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isLocalWindowsStaging,
  readStagingStartupMutationPolicy,
  requireDedicatedStagingControlPlaneWriteIdentity,
} from "./stagingStartupMutationPolicy.js";

const staging = Object.freeze({
  NODE_ENV: "staging",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  REMOTE_MCP_ENVIRONMENT: "staging",
});
const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

test("Windows Staging is detected only by exact runtime identity", () => {
  assert.equal(isLocalWindowsStaging(staging), true);
  assert.equal(isLocalWindowsStaging({ ...staging, NODE_ENV: "production" }), false);
  assert.equal(isLocalWindowsStaging({ ...staging, DEPLOYMENT_ENVIRONMENT: "production" }), false);
});

test("Windows Staging defaults to quiescent startup, even if legacy feature flags request writes", () => {
  const policy = readStagingStartupMutationPolicy({
    ...staging,
    QUEUE_WORKER_ENABLED: "TRUE",
    OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED: "false",
  });
  assert.equal(policy.active, true);
  assert.equal(policy.quiescent, true);
  assert.equal(policy.mode, "quiescent");
});

test("explicit governed mode is the only opt-in for background startup mutations", () => {
  const policy = readStagingStartupMutationPolicy({
    ...staging,
    STAGING_STARTUP_BACKGROUND_MUTATIONS_MODE: "allow_governed",
  });
  assert.equal(policy.active, true);
  assert.equal(policy.quiescent, false);
});

test("unknown policy fails closed instead of silently permitting startup writes", () => {
  assert.throws(
    () => readStagingStartupMutationPolicy({ ...staging, STAGING_STARTUP_BACKGROUND_MUTATIONS_MODE: "unsafe" }),
    (error) => error.code === "STAGING_STARTUP_MUTATION_MODE_INVALID",
  );
});

test("Production and unrelated environments are unchanged", () => {
  for (const env of [
    { NODE_ENV: "production", DEPLOYMENT_ENVIRONMENT: "production" },
    { NODE_ENV: "development" },
    { NODE_ENV: "test" },
  ]) {
    const policy = readStagingStartupMutationPolicy(env);
    assert.equal(policy.active, false);
    assert.equal(policy.quiescent, false);
    assert.doesNotThrow(() => requireDedicatedStagingControlPlaneWriteIdentity(env));
  }
});

test("Runtime DB identity fallback is forbidden in local Windows Staging", () => {
  for (const value of ["", "false", "0"]) {
    assert.throws(
      () => requireDedicatedStagingControlPlaneWriteIdentity({
        ...staging,
        CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: value,
      }),
      (error) => error.code === "STAGING_CONTROL_PLANE_WRITE_IDENTITY_REQUIRED",
    );
  }
  assert.doesNotThrow(() => requireDedicatedStagingControlPlaneWriteIdentity({
    ...staging, CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
  }));
});

test("Scheduler startup guard precedes all runtime DB pool access", () => {
  const body = read("./dynamicAuditRuntime.js").split("export async function startDynamicAuditScheduler(options = {}) {")[1];
  assert.ok(body, "startDynamicAuditScheduler missing");
  const prefix = body.slice(0, body.indexOf("const pool ="));
  assert.match(prefix, /readStagingStartupMutationPolicy\(process\.env\)/);
  assert.match(prefix, /if \(startupPolicy\.quiescent\)/);
  assert.match(prefix, /database_connection_performed: false/);
});

test("OpenAPI startup guard precedes runtime config reads and pool access", () => {
  const body = read("./openApiEndpointInventorySync.js").split("export async function startOpenApiEndpointInventorySync(deps = {}) {")[1];
  assert.ok(body, "startOpenApiEndpointInventorySync missing");
  const prefix = body.slice(0, body.indexOf("const pool ="));
  assert.match(prefix, /readStagingStartupMutationPolicy\(process\.env\)/);
  assert.match(prefix, /if \(startupPolicy\.quiescent\)/);
  assert.match(prefix, /database_connection_performed: false/);
});

test("Control Plane fallback is guarded at both config resolution and pool creation", () => {
  const source = read("./controlPlaneWriteAuthority.js");
  assert.match(source, /export function resolveControlPlaneWriteDbConfig\(env = process\.env\) \{\s*requireDedicatedStagingControlPlaneWriteIdentity\(env\);/);
  assert.match(source, /export function getControlPlaneWritePool\(env = process\.env\) \{\s*requireDedicatedStagingControlPlaneWriteIdentity\(env\);/);
});

test("Staging Compose pins quiescent mode and disables OpenAPI startup apply", () => {
  const compose = read("./docker-compose.staging.yml");
  assert.match(compose, /STAGING_STARTUP_BACKGROUND_MUTATIONS_MODE: "quiescent"/);
  assert.match(compose, /OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED: "true"/);
  assert.match(compose, /DEPLOYMENT_ENVIRONMENT: staging_local_windows_docker/);
});

test("Server validates dedicated writer before manifest generation and listener", () => {
  const server = read("./server.js");
  const validation = server.indexOf("resolveControlPlaneWriteDbConfig(process.env);");
  assert.ok(validation > 0);
  assert.ok(validation < server.indexOf("generateDeploymentManifest();"));
  assert.ok(validation < server.indexOf("app.listen(port"));
});
