import {
  getRemoteMcpCatalogReadback,
  getRemoteMcpScopeCatalog,
} from "./remoteMcpScopeCatalog.js";
import {
  envFlag,
  remoteMcpDynamicClientRegistrationAdvertised,
  remoteMcpDynamicClientRegistrationEnabled,
  resolveRemoteMcpAllowedRedirectOrigins,
} from "./remoteMcpOAuthProfile.js";

export function buildRemoteMcpScopeCatalogReadiness({ env = process.env, catalog = getRemoteMcpScopeCatalog() } = {}) {
  const catalogReadback = getRemoteMcpCatalogReadback(catalog);
  const expectedFingerprint = String(env.REMOTE_MCP_EXPECTED_CATALOG_FINGERPRINT || "").trim();
  const fingerprintMatch = !expectedFingerprint || expectedFingerprint === catalogReadback.fingerprint;
  const fingerprintRequired = envFlag(env.REMOTE_MCP_CATALOG_FINGERPRINT_REQUIRED);
  const scopes = Array.isArray(catalog.scopes) ? catalog.scopes : [];
  const writeScopes = scopes.filter((scope) => scope.effect_class !== "read_only");
  const redirectOrigins = [...resolveRemoteMcpAllowedRedirectOrigins(env)];
  const dcrEnabled = remoteMcpDynamicClientRegistrationEnabled(env);
  const redirectPolicyReady = redirectOrigins.length > 0 || envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
  return {
    ...catalogReadback,
    fingerprint_required: fingerprintRequired,
    fingerprint_match: fingerprintMatch,
    drift_detected: fingerprintRequired && !fingerprintMatch,
    expected_fingerprint: expectedFingerprint || null,
    supported_scope_count: Array.isArray(catalog.scopes)
      ? catalog.scopes.filter((scope) => scope.status === "active" && scope.effect_class === "read_only").length
      : 0,
    write_scope_count: writeScopes.length,
    default_write_scope_count: writeScopes.filter((scope) => scope.default_request === true).length,
    catalog_ready: catalogReadback.catalog_ready && (!fingerprintRequired || fingerprintMatch),
    dcr: {
      enabled: dcrEnabled,
      redirect_policy_ready: redirectPolicyReady,
      advertised: remoteMcpDynamicClientRegistrationAdvertised(env),
      approved_redirect_origin_count: redirectOrigins.length,
    },
    secrets_included: false,
  };
}
