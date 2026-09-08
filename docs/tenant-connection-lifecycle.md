# Tenant Connection Lifecycle

## Scope

This document defines the customer-facing lifecycle contract for tenant-scoped connections exposed through `/connect/api`. It does not grant provider write authority, create Production credentials, or change the WordPress resource-server boundary.

## Tenant context authority

User identity remains global, while connection operations are tenant scoped.

- `GET /connect/api/contexts` returns active tenant memberships for the authenticated user.
- `POST /connect/api/active-context` revalidates the requested tenant membership and returns a short-lived tenant-context JWT.
- Tenant-context JWT issuance is centralized in `http-generic-api/userJwtAuth.js`; route modules do not own JWT signing authority.
- The context token is HS256-bound to the repository user JWT authority, carries `purpose=connect_tenant_context`, and must not outlive the authenticated parent JWT.
- When more than one active membership exists and no signed tenant context is present, tenant-scoped connection APIs fail closed with `tenant_context_required`; they do not select the first membership implicitly.
- A signed tenant that is no longer an active membership fails closed with `tenant_context_inactive`.

## Lifecycle read model

`GET /connect/api/connections/lifecycle` projects user connections and managed connected systems into `mad4b.tenant-connection-lifecycle.v1`.

User connection states include:

- `active_pending_validation`
- `validated_ready`
- `in_use`
- `token_expiring`
- `reauth_required`
- `revoked`

Managed-system projections use `managed_ready` or `needs_attention` without pretending that a managed runtime is a user-held OAuth credential.

An `active` database row is not by itself evidence that the connection is validated or ready for use.

## WordPress Staging MCP federation

The WordPress Staging MCP profile is a credentialless tenant connection bound exactly to:

- protected resource: `https://staging.egypttourgates.com/wp-json/mcp/mad4b-read`
- authorization server issuer: `https://dev.mad4b.com/auth/mcp/wordpress-staging`
- required read scope: `mad4b:read`

`POST /connect/api/wordpress-mcp/prepare` records the tenant/user connection without storing an external bearer credential.

`POST /connect/api/wordpress-mcp/validate` performs metadata/readback validation for the exact protected resource, authorization server, read scope, and bearer challenge. Metadata success remains pending validation until subject binding and a live OAuth canary are independently verified. The lifecycle must not report `ready` solely from metadata reachability.

WordPress remains a Resource Server. This lifecycle layer does not turn WordPress into the authorization server and does not move signing authority into WordPress.

The existing CMS/Application Password connection path may coexist with the MCP federation profile; the two authentication modes are not silently converted into each other.

## Refresh and reconnect

OAuth refresh is fail closed when a provider rotates refresh credentials. If the rotated credential cannot be persisted durably, the operation must not report a durable success state. The connection is expected to move toward `reauth_required`/reconnect handling rather than hiding a broken future refresh.

## Disconnect and revocation

`DELETE /connect/api/connections/{connection_id}` revokes derivative connection authority before removing credential usability. The governed cascade covers applicable action grants, pending action requests, workspace links, CMS access grants/claims, credential bindings, and finally the user connection row/credential material.

Disconnect is tenant-and-user scoped. It does not authorize cross-tenant cleanup and does not mutate Production infrastructure.

## Safety boundary

Repository convergence and synthetic tests are not live external certification. WordPress Staging subject binding and the real ChatGPT OAuth canary remain separate deployment-time evidence and must not be inferred from repository CI alone.
