const STAGING_RUNTIME = String(process.env.NODE_ENV || "").trim().toLowerCase() === "staging"
  || String(process.env.REMOTE_MCP_ENVIRONMENT || "").trim().toLowerCase() === "staging";

export const TENANT_GPT_IS_STAGING_RUNTIME = STAGING_RUNTIME;
export const TENANT_GPT_BASE_URL = String(
  STAGING_RUNTIME
    ? process.env.TENANT_GPT_STAGING_AUTHORIZATION_SERVER_URL || "https://dev.mad4b.com"
    : process.env.TENANT_GPT_AUTHORIZATION_SERVER_URL || "https://auth.mad4b.com",
).replace(/\/+$/, "");

export const TENANT_GPT_OAUTH_CLIENT_ID = STAGING_RUNTIME
  ? (process.env.TENANT_GPT_STAGING_OAUTH_CLIENT_ID || "mad4b-tenant-gpt-staging")
  : (process.env.TENANT_GPT_OAUTH_CLIENT_ID || "mad4b-tenant-gpt");

// Scope URIs identify the shared Auth authority, not the environment-specific API resource.
// Staging still uses dev.mad4b.com as issuer/resource while consenting to the same tenant scope authority.
export const TENANT_GPT_SCOPE_AUTHORITY_URL = "https://auth.mad4b.com";

const TENANT_GPT_SCOPE_KEYS = [
  "tenant.links",
  "tenant.status",
  "tenant.activation",
  "tenant.install",
  "tenant.system-tools",
];

export const TENANT_GPT_SCOPE_LINKS = TENANT_GPT_SCOPE_KEYS.map((key) => `${TENANT_GPT_SCOPE_AUTHORITY_URL}/scopes/${key}`);
export const TENANT_GPT_SCOPE = TENANT_GPT_SCOPE_LINKS.join(" ");

export const TENANT_GPT_CALLBACK_URLS_TO_ALLOW = [
  "https://chatgpt.com/aip/g-65442952db39d61b19ccc4826d57e363de1b4455/oauth/callback",
  "https://chatgpt.com/aip/{g-GPT-ID}/oauth/callback",
  "https://chat.openai.com/aip/{g-GPT-ID}/oauth/callback",
  "https://chat.openai.com/aip/g-d36db295032b9022dd77233041763f513e8ba5fa/oauth/callback",
];

export function buildTenantGptOAuthPreset({
  baseUrl = TENANT_GPT_BASE_URL,
  schemaUrl = `${TENANT_GPT_BASE_URL}/openapi.tenant-gpt.${STAGING_RUNTIME ? "staging" : "auth"}.yaml`,
  activationSchemaUrl = STAGING_RUNTIME ? "" : "https://activation.mad4b.com/tenant-gpt/activation-openapi",
  callbackUrlsToAllow = TENANT_GPT_CALLBACK_URLS_TO_ALLOW,
  clientId = TENANT_GPT_OAUTH_CLIENT_ID,
  clientSecretEnv = STAGING_RUNTIME ? "TENANT_GPT_STAGING_OAUTH_CLIENT_SECRET" : "TENANT_GPT_OAUTH_CLIENT_SECRET",
  scopeLinks = TENANT_GPT_SCOPE_LINKS,
  notes = [],
} = {}) {
  return {
    auth_type: "OAuth",
    schema_url: schemaUrl,
    activation_schema_url: activationSchemaUrl,
    schema_urls: {
      tenant_core: schemaUrl,
      ...(activationSchemaUrl ? { tenant_activation: activationSchemaUrl } : {}),
    },
    client_id: clientId,
    client_secret: "<resolved-from-governed-platform-secret>",
    client_secret_ref: `platform_secret:${clientSecretEnv}`,
    client_secret_config_key: "tenant_gpt.oauth.client",
    authorization_url: `${baseUrl}/auth/oauth/authorize`,
    token_url: `${baseUrl}/auth/oauth/token`,
    scope: scopeLinks.join(" "),
    scope_links: scopeLinks,
    token_exchange_method: "default_post_request",
    callback_urls_to_allow: callbackUrlsToAllow,
    notes: [
      ...notes,
      STAGING_RUNTIME
        ? "Staging Tenant Core uses dev.mad4b.com and a dedicated staging OAuth client; it must never be paired with Production hosts or credentials."
        : "Configure both Tenant Core and Tenant Activation Custom GPT Actions with the same governed OAuth client.",
      "Reconnect OAuth after changing an Action server host so ChatGPT attaches the tenant access token to the new Action configuration.",
      "Use the governed client_secret_ref stored under platform_runtime_config config_key=tenant_gpt.oauth.client.",
      "The public preset endpoint does not reveal the raw client secret.",
      "ChatGPT sends the returned Mad4B tenant JWT as Authorization: Bearer <token> on action calls.",
    ],
  };
}
