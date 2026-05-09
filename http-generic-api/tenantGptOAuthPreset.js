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

export function buildTenantGptOAuthPreset({
  baseUrl = "https://auth.mad4b.com",
  schemaUrl = "https://auth.mad4b.com/openapi.tenant-gpt.auth.yaml",
} = {}) {
  return {
    auth_type: "OAuth",
    schema_url: schemaUrl,
    client_id: TENANT_GPT_OAUTH_CLIENT_ID,
    client_secret: "<generate-and-store-in-the-GPT-builder>",
    authorization_url: `${baseUrl}/auth/oauth/authorize`,
    token_url: `${baseUrl}/auth/oauth/token`,
    scope: TENANT_GPT_SCOPE,
    scope_links: TENANT_GPT_SCOPE_LINKS,
    token_exchange_method: "default_post_request",
    callback_urls_to_allow: [
      "https://chat.openai.com/aip/{g-GPT-ID}/oauth/callback",
      "https://chatgpt.com/aip/{g-GPT-ID}/oauth/callback",
    ],
    notes: [
      "Configure the Custom GPT Action Authentication Type as OAuth.",
      "OpenAI stores the client secret encrypted; keep one GPT-specific value per tenant assistant.",
      "ChatGPT sends the returned Mad4B tenant JWT as Authorization: Bearer <token> on action calls.",
    ],
  };
}
