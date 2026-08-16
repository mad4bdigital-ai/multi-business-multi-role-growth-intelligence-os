# Staging OAuth and Admin/Tenant Inspection Governance

## Purpose

This change closes the configuration gap between the published Custom GPT Staging schemas and their OAuth/runtime boundaries. It also records a governed read-only contract for an Admin that needs to inspect a Tenant's routes, tools, catalogs, or OpenAPI schema.

## Staging OAuth boundary

Staging uses `https://dev.mad4b.com` as its resource and issuer boundary. Authorization and token transport remain on `https://auth.mad4b.com/auth/oauth/authorize` and `https://auth.mad4b.com/auth/oauth/token`, but a Staging client registration must be separate from Production. Client secrets are never placed in the repository or the Config Catalog.

The exact redirect URI allowlist belongs in the OAuth client registry. It must contain only registered HTTPS callbacks for the Staging client. Missing registration, missing redirect binding, or any issuer/resource mismatch is fail-closed.

## Admin discovery versus Tenant inspection

Admin discovery of Admin/System tools remains available through the bounded Admin surface (`/gpt/tools` and `/system/tools`) when the Admin bearer/backend guard succeeds. This does not give Admin an implicit right to enumerate arbitrary Tenant routes or execute Tenant tools.

Tenant inspection requires an explicit read-only request containing:

| Field | Requirement |
|---|---|
| `tenant_id` | Explicit Tenant context; no ambiguous inference |
| `inspection_scope` | One of routes, tools, catalogs, or OpenAPI schema |
| `reason` and `owner` | Accountability and owner attestation |
| `expires_at` | Mandatory expiry; maximum TTL is 900 seconds |
| `correlation_id` | Durable audit and readback reference |

The inspection contract permits only `list_routes`, `list_tools`, `list_catalogs`, and `read_schema`. It denies tool calls, execute, create, update, delete, deploy, activation, grant, and revoke operations. Context and authority resolution must both succeed, and Admin context may not borrow Tenant authority.

## Environment isolation

Staging resources are `https://dev.mad4b.com`. Production resources are `https://auth.mad4b.com` and `https://activation.mad4b.com` where applicable. Cross-environment access is denied by policy and checked in CI. All Custom GPT schemas remain at or below the hard limit of 30 `operationId` entries.

## Operational boundary

This change adds governance contracts and CI enforcement only. It does not activate write scopes, grant Tenant delegation, perform database mutations, call providers, or promote anything to Production. The contract is ready for a future read-only runtime adapter once the application route and authority resolver are explicitly bound.
