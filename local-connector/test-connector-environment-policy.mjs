import assert from "node:assert/strict";
import test from "node:test";
import { connectorEnvironmentPolicy, resolveConnectorPolicyBinding } from "./connector-environment-policy.mjs";

test("production accepts only the canonical Production policy URL", () => {
  assert.deepEqual(resolveConnectorPolicyBinding({
    CONNECTOR_ENVIRONMENT: "production",
    CONNECTOR_POLICY_URL: "https://auth.mad4b.com/connector-agent/policy",
  }), {
    environment: "production",
    policy_url: "https://auth.mad4b.com/connector-agent/policy",
    expected_host: "auth.mad4b.com",
    compatibility_fallback_used: false,
  });
});

test("staging accepts only the canonical Staging policy URL", () => {
  assert.deepEqual(resolveConnectorPolicyBinding({
    CONNECTOR_ENVIRONMENT: "staging",
    CONNECTOR_POLICY_URL: "https://dev.mad4b.com/connector-agent/policy",
  }), {
    environment: "staging",
    policy_url: "https://dev.mad4b.com/connector-agent/policy",
    expected_host: "dev.mad4b.com",
    compatibility_fallback_used: false,
  });
});

test("staging missing policy URL fails closed and never falls back to Production", () => {
  assert.throws(
    () => resolveConnectorPolicyBinding({ CONNECTOR_ENVIRONMENT: "staging" }),
    /connector_policy_url_required:staging/,
  );
});

test("cross-environment policy host is rejected", () => {
  assert.throws(
    () => resolveConnectorPolicyBinding({
      CONNECTOR_ENVIRONMENT: "staging",
      CONNECTOR_POLICY_URL: "https://auth.mad4b.com/connector-agent/policy",
    }),
    /connector_policy_environment_mismatch:staging:dev\.mad4b\.com/,
  );
  assert.throws(
    () => resolveConnectorPolicyBinding({
      CONNECTOR_ENVIRONMENT: "production",
      CONNECTOR_POLICY_URL: "https://dev.mad4b.com/connector-agent/policy",
    }),
    /connector_policy_environment_mismatch:production:auth\.mad4b\.com/,
  );
});

test("missing environment fails closed even when a Production policy URL is supplied", () => {
  assert.throws(
    () => resolveConnectorPolicyBinding({ CONNECTOR_POLICY_URL: "https://auth.mad4b.com/connector-agent/policy" }),
    /connector_policy_environment_required:missing/,
  );
});

test("legacy Production fallback is explicit and Production-only", () => {
  const fallback = resolveConnectorPolicyBinding({ CONNECTOR_LEGACY_PRODUCTION_POLICY_FALLBACK_ENABLED: "true" });
  assert.equal(fallback.environment, "production");
  assert.equal(fallback.policy_url, connectorEnvironmentPolicy.production.policy_url);
  assert.equal(fallback.compatibility_fallback_used, true);

  assert.throws(
    () => resolveConnectorPolicyBinding({
      CONNECTOR_ENVIRONMENT: "staging",
      CONNECTOR_LEGACY_PRODUCTION_POLICY_FALLBACK_ENABLED: "true",
    }),
    /connector_policy_url_required:staging/,
  );
});

test("policy URL must be exact HTTPS endpoint without query, fragment, or alternate path", () => {
  for (const url of [
    "http://auth.mad4b.com/connector-agent/policy",
    "https://auth.mad4b.com/connector-agent/policy?x=1",
    "https://auth.mad4b.com/connector-agent/policy#x",
    "https://auth.mad4b.com/connector-agent/heartbeat",
  ]) {
    assert.throws(
      () => resolveConnectorPolicyBinding({ CONNECTOR_ENVIRONMENT: "production", CONNECTOR_POLICY_URL: url }),
      /connector_policy_environment_mismatch/,
    );
  }
});
