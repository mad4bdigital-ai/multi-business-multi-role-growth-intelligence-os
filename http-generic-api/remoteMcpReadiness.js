import { getRemoteMcpRuntimeConfiguration } from "./remoteMcpConnectorRuntime.js";
import {
  envFlag,
  remoteMcpDynamicClientRegistrationAdvertised,
  remoteMcpDynamicClientRegistrationEnabled,
  remoteMcpOAuthEnabled,
  resolveRemoteMcpAllowedRedirectOrigins,
  resolveRemoteMcpAuthorizationIssuer,
  resolveRemoteMcpOAuthSigningSecret,
} from "./remoteMcpOAuthProfile.js";
import {
  remoteMcpTrustedProxyHostHeadersEnabled,
  resolveRemoteMcpConfiguredHost,
  resolveRemoteMcpConfiguredResource,
} from "./remoteMcpRequestHost.js";

export const REMOTE_MCP_OAUTH_TABLES = Object.freeze([
  "remote_mcp_oauth_clients",
  "remote_mcp_oauth_authorization_codes",
  "remote_mcp_oauth_grants",
]);

async function inspectPersistence(pool) {
  const tables = Object.fromEntries(REMOTE_MCP_OAUTH_TABLES.map((name) => [name, false]));
  if (!pool?.query) {
    return {
      checked: false,
      ready: false,
      tables,
      error_code: "database_unavailable",
    };
  }

  try {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (?, ?, ?)`,
      REMOTE_MCP_OAUTH_TABLES,
    );
    for (const row of rows || []) {
      const name = String(row?.TABLE_NAME || row?.table_name || "");
      if (Object.hasOwn(tables, name)) tables[name] = true;
    }
    return {
      checked: true,
      ready: Object.values(tables).every(Boolean),
      tables,
      error_code: null,
    };
  } catch (error) {
    return {
      checked: false,
      ready: false,
      tables,
      error_code: String(error?.code || "database_read_failed").slice(0, 64),
    };
  }
}

export async function buildRemoteMcpReadiness({ env = process.env, pool = null } = {}) {
  const runtime = getRemoteMcpRuntimeConfiguration(env);
  const redirectOrigins = [...resolveRemoteMcpAllowedRedirectOrigins(env)];
  const redirectPolicyReady = redirectOrigins.length > 0
    || envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
  const persistence = await inspectPersistence(pool);
  const signingSecretReady = Boolean(resolveRemoteMcpOAuthSigningSecret(env));
  const dcrEnabled = remoteMcpDynamicClientRegistrationEnabled(env);
  const dcrAdvertised = remoteMcpDynamicClientRegistrationAdvertised(env);

  return {
    ok: true,
    feature: "remote_mcp_oauth_readiness",
    runtime: {
      enabled: runtime.enabled,
      oauth_enabled: remoteMcpOAuthEnabled(env),
      dcr_enabled: dcrEnabled,
      dcr_advertised: dcrAdvertised,
      legacy_user_jwt_enabled: runtime.legacy_user_jwt_enabled,
      resource: resolveRemoteMcpConfiguredResource(env),
      resource_host: resolveRemoteMcpConfiguredHost(env),
      endpoint: runtime.endpoint,
      authorization_server: resolveRemoteMcpAuthorizationIssuer(env),
      trusted_proxy_host_headers: remoteMcpTrustedProxyHostHeadersEnabled(env),
      transport: runtime.transport,
      supported_protocol_versions: runtime.supported_protocol_versions,
      supported_client_profiles: runtime.supported_client_profiles,
    },
    prerequisites: {
      redirect_policy_ready: redirectPolicyReady,
      approved_redirect_origin_count: redirectOrigins.length,
      signing_secret_ready: signingSecretReady,
      persistence,
    },
    operational_ready: Boolean(
      runtime.enabled
      && remoteMcpOAuthEnabled(env)
      && signingSecretReady
      && persistence.ready,
    ),
    registration_ready: Boolean(
      remoteMcpOAuthEnabled(env)
      && dcrEnabled
      && dcrAdvertised
      && signingSecretReady
      && persistence.ready,
    ),
    secrets_included: false,
  };
}
