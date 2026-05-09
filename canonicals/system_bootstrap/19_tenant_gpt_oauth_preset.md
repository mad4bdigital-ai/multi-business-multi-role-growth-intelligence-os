# Tenant GPT OAuth Preset

Tenant Custom GPT assistants must use the Mad4B tenant OAuth client preset for all `/connect/*`, tenant `/system/*`, app-connection, and local-connector provisioning calls. The preset is source-owned in `http-generic-api/openapi.yaml` under `x-tenant-gpt-auth.action_auth_preset`, generated into `http-generic-api/openapi.tenant-gpt.auth.yaml` as `x-gpt-action-auth-preset`, and exposed live at `https://auth.mad4b.com/tenant-gpt/oauth-preset`.

The canonical Tenant GPT Action configuration is:

| GPT Builder field | Value |
|---|---|
| Authentication Type | `OAuth` |
| Schema URL | `https://auth.mad4b.com/openapi.tenant-gpt.auth.yaml` |
| Preset URL | `https://auth.mad4b.com/tenant-gpt/oauth-preset` |
| Client ID | `mad4b-tenant-gpt` |
| Client Secret | Use the DB-backed default stored under `platform_runtime_config.config_key = tenant_gpt.oauth.client` |
| Authorization URL | `https://auth.mad4b.com/auth/oauth/authorize` |
| Token URL | `https://auth.mad4b.com/auth/oauth/token` |
| Token Exchange Method | `Default (POST request)` |
| Allowed Callback URL | `https://chat.openai.com/aip/g-d36db295032b9022dd77233041763f513e8ba5fa/oauth/callback` |

Scopes:

```text
https://auth.mad4b.com/scopes/tenant.links
https://auth.mad4b.com/scopes/tenant.status
https://auth.mad4b.com/scopes/tenant.activation
https://auth.mad4b.com/scopes/tenant.install
https://auth.mad4b.com/scopes/tenant.system-tools
```

If the GPT Builder presents a single Scope input, use the same links as one space-delimited value.

OpenAI GPT Actions require the OAuth fields to be configured in the GPT Builder authentication panel. The OpenAPI schema can declare the OAuth security scheme and carry the preset as extension metadata, but it does not replace saving the Builder authentication fields. The public preset endpoint intentionally redacts the raw client secret; platform admins seed or rotate the DB source of truth, including default allowed callback URLs, with the admin-only `tenant_gpt_oauth_client_upsert` system tool or `node scripts/upsert-tenant-gpt-oauth-client.mjs`. If the Tenant GPT calls `/connect/status` without a bearer token and receives `user_jwt_required`, treat the action as not signed in or not configured with OAuth.

The popup may use Google as upstream identity proof, but `/auth/oauth/token` must mint a fresh Mad4B-signed tenant JWT for ChatGPT. ChatGPT then sends that JWT as `Authorization: Bearer <token>` on tenant action calls. The Tenant GPT must not ask users for passwords, OAuth codes, Google ID tokens, provider tokens, API keys, connector secrets, or registration credentials in chat.

## Platform Credential Clients

Credential clients are governed DB configuration, not hardcoded prompt text. Admins can create Google-style platform credential options for API keys, OAuth clients, and service accounts through `POST /system/tools/call` with `name: "credential_client_config_upsert"` or locally with `node scripts/upsert-platform-credential-client.mjs`. The records are stored in `platform_runtime_config` with keys beginning `platform_credential_client.` and can be listed with `credential_client_config_list`.

Use this registry for platform-controlled projects now and tenant-owned projects later:

| Credential type | Purpose | Stored secret material |
|---|---|---|
| `api_key` | Simple API access and quota attribution for a controlled project | `key_secret_ref` only |
| `oauth_client` | User consent flows such as Custom GPT Actions OAuth | `client_secret_ref` only |
| `service_account` | Server-to-server platform automation | `key_secret_ref` or runtime ADC reference only |

Do not store raw API keys, OAuth client secrets, or private keys in canonical files, GPT instructions, or OpenAPI extensions. Store only secret references and allowed callback/scope metadata in the DB source of truth.
