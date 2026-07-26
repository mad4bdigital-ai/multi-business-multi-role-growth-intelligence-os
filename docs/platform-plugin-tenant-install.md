# Platform Plugin tenant install

## Purpose

After a Platform Plugin contribution is certified and promoted to Platform Base, other tenants/users need a governed way to install it without copying credentials or mutating the base definition.

`platform_plugin_install` performs that install step by combining:

- tenant policy overlay creation
- optional no-secret connection metadata registration
- execution evidence logging

## Runtime surface

- `POST /platform/plugins/install`
- Tool: `platform_plugin_install`

## Storage touched

- `tenant_integration_policies`
- optionally `user_app_connections`
- `execution_log`

The Platform Base tables remain read-only during install:

- `app_integrations`
- `app_integration_action_bindings`

## Guardrails

- The plugin must already exist in `app_integrations` with `active` or `beta` status.
- Install writes only tenant/user overlay state.
- Connection metadata must not include secrets.
- `api_base_url`, `mcp_endpoint`, and `webhook_url` must use HTTPS.
- `encrypted_credentials` and `credential_ref` are not accepted by this install surface.
- Real credentials must be supplied later through governed credential intake or OAuth.

## Lifecycle position

1. Contribution is promoted to Platform Base.
2. Tenant installs the promoted plugin.
3. Tenant/user attaches no-secret metadata or completes credential intake.
4. Resolver can evaluate action availability for that tenant.
5. Execution dispatch remains governed by runtime adapters and credential resolvers.
