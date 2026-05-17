# Platform Connector Registry Taxonomy

## Purpose

This document defines the practical taxonomy for platform tables that describe external systems, API capability groups, callable endpoint tools, app integrations, and tenant/user connection state.

The goal is to prevent table drift by assigning one clear responsibility to each registry layer before adding more migrations or runtime behavior.

## Core rule

Do not treat every integration table as the same kind of object.

A platform connection has four different meanings:

1. **Capability contract**: what the platform knows how to call.
2. **Operation contract**: the exact API endpoint, method, path, schema, auth and transport rules.
3. **Exposure contract**: which operations are safe and useful enough to expose as GPT/system tools.
4. **Installed connection or system instance**: what a tenant/user/brand has actually connected or configured.

## Current source-of-truth layers

### `actions`

Role: provider capability groups and parent-level auth strategy authority.

Use for external REST API groups, MCP client groups, native runtime controllers, resolver-only records, and transport executors.

Examples:

- `github_api_mcp`
- `google_drive_api`
- `wordpress_api`
- `hostinger_api`
- `makecom_mcp_client`
- `http_generic_api`
- `site_migration_controller`

Rules:

- `actions` is not the app marketplace.
- `actions` is not an installed tenant connection table.
- `actions.action_key` is the parent key for executable endpoint contracts.
- `actions.runtime_binding_profile.auth_strategy` is the default credential-selection policy for all child endpoints.
- `runtime_capability_class` should classify the capability layer, such as `external_action_only`, `mcp_connector`, `http_transport_executor`, `native_runtime`, or `resolver_only_registry`.

Parent auth strategy supports the runtime scopes `platform`, `tenant`, `user`, `connection`, and `auto`. The standard resolution order is explicit connection, user primary connection, tenant primary connection, then platform secret only when fallback policy allows it. See `docs/external-endpoint-auth-strategy.md`.

### `endpoints`

Role: provider operation contracts under an `actions.action_key`.

Use for exact runtime-callable operation metadata: endpoint key, provider domain, method, path or function, schema, auth readiness, transport requirements, and execution mode.

Rules:

- Every executable provider operation should belong to one `parent_action_key`.
- Endpoint rows are not automatically GPT-callable tools.
- Endpoint-local `schema_json` is the runtime contract source for request and response validation.

### `platform_endpoint_tool_exports`

Role: curated endpoint-to-tool exposure bridge.

Use when a specific endpoint is intentionally exposed through `/system/tools` or other governed tool facades.

Rules:

- This is a curated allowlist, not a mirror of all active endpoints.
- Use `scope_class` to decide admin, tenant, or both.
- Use `input_schema_json`, `auth_policy_json`, and `execution_policy_json` for GPT-facing contracts and safety policy.
- Do not bypass this table by querying endpoint rows directly for tool exposure.

### `admin_platform_endpoint_tools` and `tenant_platform_endpoint_tools`

Role: manual dispatcher tool registries.

Use for platform tools that map directly to backend routes or virtual handlers, not for dynamic provider endpoint exports.

Examples:

- `admin_control`
- `repo_inspect`
- `repo_patch_apply`
- `release_readiness`
- connector/device tools

Rules:

- These tables use `tool_key`, not `tool_name`.
- They are not replacements for `platform_endpoint_tool_exports`.

### `app_integrations`

Role: app catalog and marketplace registry.

Use for apps that a user or tenant can connect, such as GitHub, WordPress REST, Google Drive, Make.com MCP, Slack, Notion, Hostinger, Cloudflare, or a custom webhook.

Rules:

- `app_integrations` describes the app product surface.
- It does not prove a user or tenant has connected credentials.
- It should be bridged to `actions` through `app_integration_action_bindings` when the app has runtime API capability groups.

### `user_app_connections`

Role: user/tenant credential connection source of truth.

Use for encrypted credentials, OAuth scopes, validation status, token expiry, account labels, MCP endpoint URLs, webhooks, and last-used telemetry.

Rules:

- This is the current install-state source of truth for app credentials.
- Secret material remains encrypted or referenced, never duplicated into capability tables.

### `workspace_app_links`

Role: optional workspace-level attachment of a user app connection.

Use when a connection should be made available to a specific workspace with a permission mode.

### `app_action_grants` and `app_action_requests`

Role: app-action permission and approval layer.

Use for per-connection action authorization, default grants, and approval requests.

Rules:

- Keep these tables even if empty until product flows decide otherwise.
- They are permission state, not provider operation definitions.

### `connected_systems`

Role: tenant/system/domain inventory.

Use for provider domains, brand/site systems, local/device surfaces, service-mode support, and connector availability.

Rules:

- This table describes configured systems or provider instances.
- It does not replace `actions` or `endpoints`.
- It does not replace `user_app_connections` for credentials.

### `installations`

Role: deprecated legacy install-state table.

Current runtime state lives in `user_app_connections` and `connected_systems`.

Rules:

- Do not use this table as an authoritative source for app install state.
- Either keep it as a legacy compatibility surface or replace it later with a read-only view/materialized mirror.

### `agent_tool_bindings`

Role: deprecated early agent binding table.

Prefer skill and workflow binding tables for future agent runtime authorization.

## Proposed bridge/catalog tables

### `connector_family_registry`

Normalizes connector/provider family strings used across `actions`, `endpoints`, `connected_systems`, and app bindings.

Intended columns:

- `connector_family`
- `provider_family`
- `display_name`
- `protocol_type`
- `provider_domain_mode`
- `connection_scope`
- `runtime_layer`
- `default_auth_mode`
- `status`

### `app_integration_action_bindings`

Links app catalog entries to capability groups.

Intended columns:

- `app_key`
- `action_key`
- `binding_role`
- `credential_source`
- `exposure_default`
- `status`

Examples:

- `github` -> `github_api_mcp`
- `github` -> `github_git_data`
- `github` -> `github_actions_status`
- `wordpress_rest` -> `wordpress_api`
- `makecom_mcp` -> `makecom_mcp_client`
- `google_drive` -> `google_drive_api`
- `google_docs` -> `google_docs_api`
- `google_sheets` -> `google_sheets_api`

## Safe migration approach

1. Add taxonomy documentation first.
2. Add bridge/catalog tables without changing runtime behavior.
3. Seed existing known relationships.
4. Add read-only diagnostics and reports.
5. Only then decide whether runtime code should use the new bridge tables.

## Non-goals

- Do not merge all connection concepts into one large table.
- Do not auto-expose all active endpoints as tools.
- Do not move encrypted credentials into action or endpoint rows.
- Do not delete legacy tables until callers and reports are audited.
