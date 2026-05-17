# External Endpoint Auth Strategy

## Purpose

External API authentication is governed at the **Parent Action** level. Endpoints inherit the parent policy by default, and individual endpoints may override only when their operation has a narrower security requirement.

This prevents auth behavior from being duplicated across hundreds of endpoint rows while still letting users choose the credential source that fits their work.

## Authority model

```text
Parent action auth_strategy
  -> endpoint auth_strategy_override, optional
  -> platform_endpoint_tool_exports input schema
  -> runtime credential resolver
  -> outbound auth injection
```

The authoritative parent policy lives in:

```text
actions.runtime_binding_profile.auth_strategy
```

The optional endpoint override lives in:

```text
endpoints.runtime_binding_profile.auth_strategy_override
```

Exported tools expose the runtime selectors through:

```text
platform_endpoint_tool_exports.input_schema_json
platform_endpoint_tool_exports.auth_policy_json
```

## Parent action policy shape

Example:

```json
{
  "auth_strategy": {
    "auth_strategy_version": 1,
    "default_scope": "platform",
    "supported_scopes": ["platform", "tenant", "user", "connection"],
    "credential_resolution_order": [
      "request_connection",
      "user_primary_connection",
      "tenant_primary_connection",
      "platform_secret"
    ],
    "allow_platform_fallback_default": true,
    "allowed_auth_types": [
      "oauth2",
      "api_key",
      "bearer_token",
      "basic_auth",
      "custom_headers",
      "client_credentials"
    ],
    "app_key": "google_drive",
    "required_scopes": ["https://www.googleapis.com/auth/drive"]
  }
}
```

## Runtime selector contract

Any exported external endpoint tool may accept:

```json
{
  "credential_scope": "platform | user | tenant | connection | auto",
  "user_id": "optional user id",
  "tenant_id": "optional tenant id",
  "connection_id": "optional explicit user_app_connections.connection_id",
  "app_key": "optional app key override",
  "scopes": "optional required OAuth scopes",
  "auth_type": "optional auth type override",
  "allow_platform_fallback": false,
  "auth_context": {
    "credential_scope": "user",
    "user_id": "...",
    "tenant_id": "...",
    "connection_id": "...",
    "app_key": "...",
    "scopes": "...",
    "auth_type": "...",
    "allow_platform_fallback": false
  }
}
```

`auth_context` is the advanced envelope. Top-level fields are copied into it by `executionPreparation.js` so callers can use either form.

## Credential scopes

| Scope | Behavior |
|---|---|
| `platform` | Use the platform-managed credential on the parent action. |
| `user` | Resolve the signed-in or supplied user's active `user_app_connections` row. |
| `tenant` | Resolve the tenant primary active `user_app_connections` row. |
| `connection` | Use the explicit `connection_id` from `user_app_connections`. |
| `auto` | Try explicit connection, then user, then tenant when identifiers are present. |

## Fallback rule

When the caller explicitly requests `user`, `tenant`, or `connection` and sets:

```json
{ "allow_platform_fallback": false }
```

the runtime must **not** use a platform secret if the scoped credential is missing.

Expected error:

```json
{
  "ok": false,
  "error": {
    "code": "external_credential_connection_not_found",
    "status": 403
  }
}
```

This rule is mandatory for user privacy and tenant isolation.

## Runtime implementation

Key files:

| File | Responsibility |
|---|---|
| `http-generic-api/userAppConnectionCredentials.js` | Decrypt and resolve user/tenant/connection credentials from `user_app_connections`. |
| `http-generic-api/authCredentialResolution.js` | Resolve parent action auth strategy and build auth contracts. |
| `http-generic-api/authInjection.js` | Infer auth mode and inject auth headers/query params. |
| `http-generic-api/executionPreparation.js` | Merge runtime auth selectors into `auth_context` before execution. |
| `http-generic-api/routes/systemLayerRoutes.js` | Forward auth selectors from exported tool calls to the runtime endpoint facade. |

## Current supported credential types

The generic resolver can source these from `user_app_connections.encrypted_credentials`:

- `oauth2`
- `api_key`
- `bearer_token`
- `basic_auth`
- `custom_headers`
- `client_credentials` as an allowed strategy class, with provider-specific handling added as needed

Secret material must remain encrypted in `user_app_connections.encrypted_credentials` or referenced through a secret store. Do not copy user secrets into `actions`, `endpoints`, or tool export rows.

## Examples

### Platform-owned Cloudflare DNS

```json
{
  "query": { "name": "mad4b.com", "per_page": 1 },
  "credential_scope": "platform",
  "allow_platform_fallback": true
}
```

Expected result: platform Cloudflare token is used.

### User-owned Cloudflare token only

```json
{
  "query": { "name": "mad4b.com", "per_page": 1 },
  "credential_scope": "user",
  "user_id": "<user_id>",
  "allow_platform_fallback": false
}
```

Expected result: runtime uses the user's active `cloudflare` connection or returns `external_credential_connection_not_found`.

### User-owned Google Drive

```json
{
  "query": {
    "q": "'<folder_id>' in parents and trashed=false",
    "fields": "files(id,name,mimeType,modifiedTime),nextPageToken",
    "pageSize": 100,
    "supportsAllDrives": true,
    "includeItemsFromAllDrives": true
  },
  "credential_scope": "user",
  "user_id": "<user_id>",
  "allow_platform_fallback": false
}
```

Expected result: runtime uses the user's Google OAuth connection. If none exists, it must not use the platform service account.

## Migration

The DB reconciliation migration is:

```text
http-generic-api/migrations/076_sprint61_parent_action_auth_strategy.sql
```

It is idempotent and only uses `UPDATE`/`JSON_SET` on existing rows. It does not delete, truncate, or drop data.

## Verification checklist

After changing auth strategy code or rows:

1. Run or verify GitHub Actions CI until all jobs are green.
2. Test one platform-scoped external endpoint.
3. Test one user-scoped endpoint with `allow_platform_fallback=false` and no user connection; it must return 403, not silently use platform credentials.
4. Test a real user connection once an OAuth/API-key intake flow is available.
5. Confirm `platform_endpoint_tool_exports.input_schema_json` exposes the auth selector fields for exported external tools.
