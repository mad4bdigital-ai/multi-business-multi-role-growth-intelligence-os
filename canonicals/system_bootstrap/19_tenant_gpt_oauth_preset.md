# Tenant GPT OAuth Preset

Tenant Custom GPT assistants must use the Mad4B tenant OAuth client preset for all `/connect/*`, tenant `/system/*`, app-connection, and local-connector provisioning calls. The preset is source-owned in `http-generic-api/openapi.yaml` under `x-tenant-gpt-auth.action_auth_preset`, generated into `http-generic-api/openapi.tenant-gpt.auth.yaml` as `x-gpt-action-auth-preset`, and exposed live at `https://auth.mad4b.com/tenant-gpt/oauth-preset`.

The canonical Tenant GPT Action configuration is:

| GPT Builder field | Value |
|---|---|
| Authentication Type | `OAuth` |
| Schema URL | `https://auth.mad4b.com/openapi.tenant-gpt.auth.yaml` |
| Preset URL | `https://auth.mad4b.com/tenant-gpt/oauth-preset` |
| Client ID | `mad4b-tenant-gpt` |
| Client Secret | Generate and store one GPT-specific secret in the GPT Builder |
| Authorization URL | `https://auth.mad4b.com/auth/oauth/authorize` |
| Token URL | `https://auth.mad4b.com/auth/oauth/token` |
| Token Exchange Method | `Default (POST request)` |

Scopes:

```text
https://auth.mad4b.com/scopes/tenant.links
https://auth.mad4b.com/scopes/tenant.status
https://auth.mad4b.com/scopes/tenant.activation
https://auth.mad4b.com/scopes/tenant.install
https://auth.mad4b.com/scopes/tenant.system-tools
```

If the GPT Builder presents a single Scope input, use the same links as one space-delimited value.

OpenAI GPT Actions require the OAuth fields to be configured in the GPT Builder authentication panel. The OpenAPI schema can declare the OAuth security scheme and carry the preset as extension metadata, but it does not replace saving the Builder authentication fields. If the Tenant GPT calls `/connect/status` without a bearer token and receives `user_jwt_required`, treat the action as not signed in or not configured with OAuth.

The popup may use Google as upstream identity proof, but `/auth/oauth/token` must mint a fresh Mad4B-signed tenant JWT for ChatGPT. ChatGPT then sends that JWT as `Authorization: Bearer <token>` on tenant action calls. The Tenant GPT must not ask users for passwords, OAuth codes, Google ID tokens, provider tokens, API keys, connector secrets, or registration credentials in chat.
