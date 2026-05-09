export const TENANT_GPT_OAUTH_CLIENT_ID =
  process.env.TENANT_GPT_OAUTH_CLIENT_ID || "mad4b-tenant-gpt";

export const TENANT_GPT_SCOPE_LINKS = [
  "https://auth.mad4b.com/scopes/tenant.links",
  "https://auth.mad4b.com/scopes/tenant.status",
  "https://auth.mad4b.com/scopes/tenant.activation",
  "https://auth.mad4b.com/scopes/tenant.install",
  "https://auth.mad4b.com/scopes/tenant.system-tools",
];

export const TENANT_GPT_SCOPE = TENANT_GPT_SCOPE_LINKS.join(" ");

export const TENANT_GPT_CALLBACK_URLS_TO_ALLOW = [
  "https://chat.openai.com/aip/g-d36db295032b9022dd77233041763f513e8ba5fa/oauth/callback",
  "https://chat.openai.com/aip/{g-GPT-ID}/oauth/callback",
  "https://chatgpt.com/aip/{g-GPT-ID}/oauth/callback",
];

export function buildTenantGptOAuthPreset({
  baseUrl = "https://auth.mad4b.com",
  schemaUrl = "https://auth.mad4b.com/openapi.tenant-gpt.auth.yaml",
  callbackUrlsToAllow = TENANT_GPT_CALLBACK_URLS_TO_ALLOW,
} = {}) {
  return {
    auth_type: "OAuth",
    schema_url: schemaUrl,
    client_id: TENANT_GPT_OAUTH_CLIENT_ID,
    client_secret: "<stored-in-platform-runtime-config>",
    client_secret_config_key: "tenant_gpt.oauth.client",
    authorization_url: `${baseUrl}/auth/oauth/authorize`,
    token_url: `${baseUrl}/auth/oauth/token`,
    scope: TENANT_GPT_SCOPE,
    scope_links: TENANT_GPT_SCOPE_LINKS,
    token_exchange_method: "default_post_request",
    callback_urls_to_allow: callbackUrlsToAllow,
    notes: [
      "Configure the Custom GPT Action Authentication Type as OAuth.",
      "Use the DB-backed client secret stored under platform_runtime_config config_key=tenant_gpt.oauth.client.",
      "The public preset endpoint does not reveal the raw client secret.",
      "ChatGPT sends the returned Mad4B tenant JWT as Authorization: Bearer <token> on action calls.",
    ],
  };
}
