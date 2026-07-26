# Platform Plugin catalog notes

## Purpose

A **Platform Plugin** is the governed extension unit for the Growth Intelligence Platform. It can represent REST APIs, OAuth apps, MCP servers, webhooks, browser automation, local connector capabilities, AI providers, storage adapters, workflow packs, or future protocols.

This change introduces a read-only catalog surface that normalizes the current integration tables into Platform Plugin terminology. It does **not** create a new authority table and does **not** mutate runtime execution.

## Current storage model

The read model maps existing tables as follows:

| Platform Plugin concept | Current table |
|---|---|
| Plugin definition | `app_integrations` |
| Action bindings | `app_integration_action_bindings` |
| Tool bindings | `app_integration_tool_bindings` |
| Tenant overlay | `tenant_integration_policies` |
| User/tenant credentials | `user_app_connections` |

## Runtime rules preserved

- Platform defaults are read-only from this surface.
- Tenant overlays must be represented as scoped policy rows, not updates to platform defaults.
- User credentials are summarized without returning secrets.
- Protocols are inferred from the definition and binding metadata.
- Credential resolver policy is descriptive in this first step; runtime execution remains governed by existing resolvers and dispatch surfaces.

## New route and tool

- Route: `GET /platform/plugins/catalog`
- Tool key: `platform_plugin_catalog`
- Scope: admin read-only diagnostics
- No secrets included.

## Next implementation step

The next safe step is a resolver-only service that evaluates one requested plugin/action against platform definition, tenant policy, user connection, and agent skill grants, returning an allow/deny envelope without executing the action.
