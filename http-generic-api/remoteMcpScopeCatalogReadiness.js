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
  const redirectOrigins = [...resolveRemoteMcpAllowedRedirectOrigins(env)];
  const dcrEnabled = remoteMcpDynamicClientRegistrationEnabled(env);
  const redirectPolicyReady = redirectOrigins.length > 0 || envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
  return {
    ...catalogReadback,
    dcr: {
      enabled: dcrEnabled,
      redirect_policy_ready: redirectPolicyReady,
      advertised: remoteMcpDynamicClientRegistrationAdvertised(env),
      approved_redirect_origin_count: redirectOrigins.length,
    },
    secrets_included: false,
  };
}
