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
import { buildRemoteMcpWriteScopeReadback } from "./remoteMcpWriteScopeGovernance.js";

export function buildRemoteMcpScopeCatalogReadiness({ env = process.env, catalog = getRemoteMcpScopeCatalog() } = {}) {
  const catalogReadback = getRemoteMcpCatalogReadback(catalog);
  const expectedFingerprint = String(env.REMOTE_MCP_EXPECTED_CATALOG_FINGERPRINT || "").trim();
  const fingerprintMatch = !expectedFingerprint || expectedFingerprint === catalogReadback.fingerprint;
  const fingerprintRequired = envFlag(env.REMOTE_MCP_CATALOG_FINGERPRINT_REQUIRED);
  const scopes = Array.isArray(catalog.scopes) ? catalog.scopes : [];
  const writeScopes = scopes.filter((scope) => scope.effect_class !== "read_only");
  const supportedScopeCount = scopes.filter((scope) => scope.status === "active" && scope.effect_class === "read_only").length;
  const redirectOrigins = [...resolveRemoteMcpAllowedRedirectOrigins(env)];
  const writeGovernance = buildRemoteMcpWriteScopeReadback({ env, catalog });
  const catalogValid = catalogReadback.catalog_ready === true;
  const catalogReady = catalogValid && (!fingerprintRequired || fingerprintMatch);
  const inventoryReady = writeGovernance.inventory_ready === true;
  const writeReady = Boolean(
    catalogReady
    && inventoryReady
    && writeGovernance.activation_ready
    && writeGovernance.unclassified_write_route_count === 0
    && writeGovernance.intentionally_unmapped_write_route_count === 0
    && writeGovernance.provider_mutation_allowed === true,
  );
  const dcrEnabled = remoteMcpDynamicClientRegistrationEnabled(env);
  const redirectPolicyReady = redirectOrigins.length > 0 || envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
  return {
    ...catalogReadback,
    fingerprint_required: fingerprintRequired,
    fingerprint_match: fingerprintMatch,
    drift_detected: fingerprintRequired && !fingerprintMatch,
    expected_fingerprint: expectedFingerprint || null,
    supported_scope_count: supportedScopeCount,
    write_scope_count: writeScopes.length,
    default_write_scope_count: writeScopes.filter((scope) => scope.default_request === true).length,
    catalog_valid: catalogValid,
    catalog_ready: catalogReady,
    inventory_ready: inventoryReady,
    write_ready: writeReady,
    operational_ready: Boolean(catalogReady && supportedScopeCount > 0),
    write_governance: writeGovernance,
    dcr: {
      enabled: dcrEnabled,
      redirect_policy_ready: redirectPolicyReady,
      advertised: remoteMcpDynamicClientRegistrationAdvertised(env),
      approved_redirect_origin_count: redirectOrigins.length,
    },
    secrets_included: false,
  };
}
