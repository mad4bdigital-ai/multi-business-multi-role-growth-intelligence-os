import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyConnectorServerEnvironmentGuard, shouldGuardConnectorServer } from "./connector-runtime-bootstrap.mjs";

test("server entrypoint is guarded while normal module tests are not", () => {
  assert.equal(shouldGuardConnectorServer(["node", "C:\\mad4b\\local-connector\\server.mjs"]), true);
  assert.equal(shouldGuardConnectorServer(["node", "/opt/local-connector/server.mjs"]), true);
  assert.equal(shouldGuardConnectorServer(["node", "/repo/local-connector/test-browser4-adapter.mjs"]), false);
});

test("bootstrap reads .env before server config and pins staging policy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-connector-bootstrap-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, [
    "CONNECTOR_ENVIRONMENT=staging",
    "CONNECTOR_POLICY_URL=https://dev.mad4b.com/connector-agent/policy",
    "",
  ].join("\n"));
  const env = {};
  const result = applyConnectorServerEnvironmentGuard({ env, envFile });
  assert.equal(result.environment, "staging");
  assert.equal(result.policy_url, "https://dev.mad4b.com/connector-agent/policy");
  assert.equal(env.CONNECTOR_POLICY_URL, "https://dev.mad4b.com/connector-agent/policy");
});

test("bootstrap rejects staging with missing policy instead of allowing Production fallback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-connector-bootstrap-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, "CONNECTOR_ENVIRONMENT=staging\n");
  assert.throws(
    () => applyConnectorServerEnvironmentGuard({ env: {}, envFile }),
    /connector_policy_url_required:staging/,
  );
});

test("bootstrap allows legacy Production fallback only behind explicit compatibility flag", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-connector-bootstrap-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, [
    "CONNECTOR_ENVIRONMENT=production",
    "CONNECTOR_LEGACY_PRODUCTION_POLICY_FALLBACK_ENABLED=true",
    "",
  ].join("\n"));
  const env = {};
  const result = applyConnectorServerEnvironmentGuard({ env, envFile });
  assert.equal(result.compatibility_fallback_used, true);
  assert.equal(env.CONNECTOR_POLICY_URL, "https://auth.mad4b.com/connector-agent/policy");
});

test("policy-disabled runtime still requires an explicit known environment", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-connector-bootstrap-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, "CONNECTOR_POLICY_ENABLED=false\n");
  assert.throws(
    () => applyConnectorServerEnvironmentGuard({ env: {}, envFile }),
    /connector_policy_environment_required:missing/,
  );
});
