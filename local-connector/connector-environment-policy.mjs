const ENVIRONMENT_POLICY = Object.freeze({
  production: Object.freeze({
    control_plane_host: "auth.mad4b.com",
    policy_url: "https://auth.mad4b.com/connector-agent/policy",
  }),
  staging: Object.freeze({
    control_plane_host: "dev.mad4b.com",
    policy_url: "https://dev.mad4b.com/connector-agent/policy",
  }),
});

function normalizeEnvironment(value) {
  return String(value || "").trim().toLowerCase();
}

function parseExactPolicyUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.pathname !== "/connector-agent/policy" || parsed.search || parsed.hash) return null;
  return parsed;
}

export function resolveConnectorPolicyBinding(env = process.env) {
  const environment = normalizeEnvironment(env.CONNECTOR_ENVIRONMENT);
  const compatibilityFallbackEnabled = String(env.CONNECTOR_LEGACY_PRODUCTION_POLICY_FALLBACK_ENABLED || "").trim().toLowerCase() === "true";
  const configuredPolicyUrl = String(env.CONNECTOR_POLICY_URL || "").trim().replace(/\/$/, "");

  if (!ENVIRONMENT_POLICY[environment]) {
    if (!environment && compatibilityFallbackEnabled && !configuredPolicyUrl) {
      return {
        environment: "production",
        policy_url: ENVIRONMENT_POLICY.production.policy_url,
        expected_host: ENVIRONMENT_POLICY.production.control_plane_host,
        compatibility_fallback_used: true,
      };
    }
    throw new Error(`connector_policy_environment_required:${environment || "missing"}`);
  }

  if (!configuredPolicyUrl) {
    if (environment === "production" && compatibilityFallbackEnabled) {
      return {
        environment,
        policy_url: ENVIRONMENT_POLICY.production.policy_url,
        expected_host: ENVIRONMENT_POLICY.production.control_plane_host,
        compatibility_fallback_used: true,
      };
    }
    throw new Error(`connector_policy_url_required:${environment}`);
  }

  const parsed = parseExactPolicyUrl(configuredPolicyUrl);
  const expected = ENVIRONMENT_POLICY[environment];
  if (!parsed || parsed.hostname.toLowerCase() !== expected.control_plane_host || configuredPolicyUrl !== expected.policy_url) {
    throw new Error(`connector_policy_environment_mismatch:${environment}:${expected.control_plane_host}`);
  }

  return {
    environment,
    policy_url: expected.policy_url,
    expected_host: expected.control_plane_host,
    compatibility_fallback_used: false,
  };
}

export const connectorEnvironmentPolicy = ENVIRONMENT_POLICY;
