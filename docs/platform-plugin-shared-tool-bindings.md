# Shared Platform Plugin tool bindings

## Purpose

Platform Plugins should share governed connection, credential-status, and local bridge surfaces rather than requiring raw tokens on individual devices or ad-hoc HTTP clients.

## Base bindings

Every active or beta Platform Plugin receives common admin-platform tool bindings:

- `credential_intake_session_create`
- `admin_app_connection_create`
- `credential_effective_status`

These bindings route through governed credential intake and encrypted connection storage. They do not store or expose credential values in the plugin registry.

## Local bridges

Device-tool bridges are bound only where a matching governed local connector tool exists:

- `github` → `connector_github`
- `google_cloud` → `connector_gcloud`
- `cloudflare` → `connector_cf`
- `n8n` → `connector_n8n`

Local bridges are optional execution paths. Platform-managed HTTP/API paths remain preferred when a local device credential is missing or invalid.

## Tenant overlays

This migration does not install all plugins for any tenant. Tenant enablement remains an overlay operation through `tenant_integration_policies` or the Platform Plugin install flow.

## Secret boundary

The migration inserts metadata and bindings only. It does not insert tokens, credential references, encrypted credentials, or provider secrets.
