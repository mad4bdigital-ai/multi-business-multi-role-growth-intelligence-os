import { getRemoteMcpRuntimeConfiguration } from "./remoteMcpConnectorRuntime.js";
import { buildRemoteMcpScopeCatalogReadiness } from "./remoteMcpScopeCatalogReadiness.js";
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

export const REMOTE_MCP_SCOPE_CATALOG_TABLES = Object.freeze([
  "platform_oauth_scope_registry",
  "platform_resource_scope_bindings",
  "platform_tool_scope_bindings",
  "platform_scope_implications",
  "platform_scope_catalog_revisions",
]);

async function inspectTableSet(pool, tableNames, errorCode) {
  const tables = Object.fromEntries(tableNames.map((name) => [name, false]));
  if (!pool?.query) {
    return { checked: false, ready: false, tables, error_code: "database_unavailable" };
  }
  try {
    const placeholders = tableNames.map(() => "?").join(", ");
    const [rows] = await pool.query(
      `SELECT TABLE_NAME
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${placeholders})`,
      tableNames,
    );
    for (const row of rows || []) {
      const name = String(row?.TABLE_NAME || row?.table_name || "");
      if (Object.hasOwn(tables, name)) tables[name] = true;
    }
    return { checked: true, ready: Object.values(tables).every(Boolean), tables, error_code: null };
  } catch (error) {
    return {
      checked: false,
      ready: false,
      tables,
      error_code: String(error?.code || errorCode).slice(0, 64),
    };
  }
}

async function inspectPersistence(pool) {
  return inspectTableSet(pool, REMOTE_MCP_OAUTH_TABLES, "database_read_failed");
}

async function inspectScopeCatalogPersistence(pool) {
  return inspectTableSet(pool, REMOTE_MCP_SCOPE_CATALOG_TABLES, "scope_catalog_database_read_failed");
}

export async function buildRemoteMcpReadiness({ env = process.env, pool = null } = {}) {
  const runtime = getRemoteMcpRuntimeConfiguration(env);
  const redirectOrigins = [...resolveRemoteMcpAllowedRedirectOrigins(env)];
  const redirectPolicyReady = redirectOrigins.length > 0
    || envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
  const persistence = await inspectPersistence(pool);
  const scopeCatalogPersistence = await inspectScopeCatalogPersistence(pool);
  const signingSecretReady = Boolean(resolveRemoteMcpOAuthSigningSecret(env));
  const dcrEnabled = remoteMcpDynamicClientRegistrationEnabled(env);
  const dcrAdvertised = remoteMcpDynamicClientRegistrationAdvertised(env);
  const catalogReadiness = buildRemoteMcpScopeCatalogReadiness({ env });

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
    catalog: catalogReadiness,
    prerequisites: {
      redirect_policy_ready: redirectPolicyReady,
      approved_redirect_origin_count: redirectOrigins.length,
      signing_secret_ready: signingSecretReady,
      persistence: {
        ...persistence,
        scope_catalog: scopeCatalogPersistence,
        scope_catalog_ready: scopeCatalogPersistence.ready,
      },
    },
    operational_ready: Boolean(
      runtime.enabled
      && remoteMcpOAuthEnabled(env)
      && signingSecretReady
      && persistence.ready
      && catalogReadiness.operational_ready,
    ),
    catalog_valid: catalogReadiness.catalog_valid,
    inventory_ready: catalogReadiness.inventory_ready,
    write_ready: Boolean(
      runtime.enabled
      && remoteMcpOAuthEnabled(env)
      && signingSecretReady
      && persistence.ready
      && persistence.scope_catalog_ready
      && catalogReadiness.write_ready,
    ),
    registration_ready: Boolean(
      remoteMcpOAuthEnabled(env)
      && dcrEnabled
      && dcrAdvertised
      && signingSecretReady
      && persistence.ready
      && catalogReadiness.operational_ready,
    ),
    secrets_included: false,
  };
}
