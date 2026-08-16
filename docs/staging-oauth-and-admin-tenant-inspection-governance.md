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

The inspection contract permits only `list_routes`, `list_tools`, `list_catalogs`, and `read_schema`. It denies tool calls, execute, create, update, delete, deploy, activation, grant, and revoke operations. Context and authority resolution must both succeed, and Admin context may not borrow Tenant authority. The contract is explicitly `runtime_binding.status=not_bound` with `deny_until_bound=true`; it must not be interpreted as an already-live Admin-to-Tenant inspection endpoint.

## Hierarchical Act-as-User contract

The general model is not limited to platform Admin. A Tenant Responsible, Owner, Admin, Supervisor, or Manager may request an Act-as-User session for a lower-ranked active member of the same Tenant. The target user must never be outside the actor's Tenant or above the actor's effective role.

For `call_tool` and `execute`, the effective authority is the intersection of the actor's authority, target user's authority, Tenant boundary, and tool-level capability. It is not the union of the two identities, and it cannot grant a capability the target user does not already possess. Every request requires `tenant_id`, `target_user_id`, `operation_scope`, reason, owner, expiry, correlation ID, active target membership, and an active delegation record. The maximum session TTL is 900 seconds.

The contract is currently `status=not_bound` and `deny_until_bound=true`. Therefore, the schema explicitly describes the intended capability without enabling live impersonation. A future runtime adapter must issue a distinct Act-as-User session, preserve both actor and target identities in every call log, enforce lower-role ordering and authority intersection before dispatch, and support immediate revocation.

## Objection review and controls

| Potential objection | Required control | Current status |
|---|---|---|
| The actor could become the target or substitute a stronger token | Immutable actor and target identities; no token substitution | Required by contract; runtime adapter pending |
| A manager could target an equal or higher role | Strict lower-role check and fail-closed role resolution | Required by contract; runtime adapter pending |
| The request could cross Tenant boundaries | Explicit same-Tenant binding and active target membership | Required by contract; runtime adapter pending |
| `call` or `execute` could become unrestricted | Per-tool explicit binding and actor ∩ target ∩ Tenant ∩ tool authority | Required by contract; runtime adapter pending |
| A wildcard scope could silently expand authority | Wildcards rejected; maximum 50 operation-scope entries | Enforced by CI contract guard |
| A captured session could be replayed | Idempotency key, replay protection, expiry, and revocation | Required by contract; runtime adapter pending |
| Sensitive tools could be run without extra assurance | Step-up control for sensitive tools | Required by contract; runtime adapter pending |
| Audit logs could leak credentials or tokens | Secrets forbidden in audit records; actor/target/correlation/readback retained | Required by contract; runtime adapter pending |

These controls deliberately distinguish **design readiness** from **runtime activation**. The PR does not claim that live impersonation is already safe merely because the contract exists; it requires implementation evidence for each control before `status` can move from `not_bound`.

## Environment isolation

Staging resources are `https://dev.mad4b.com`. Production resources are `https://auth.mad4b.com` and `https://activation.mad4b.com` where applicable. Cross-environment access is denied by policy and checked in CI. All Custom GPT schemas remain at or below the hard limit of 30 `operationId` entries.

## Runtime hardening and evidence

The OAuth runtime now normalizes configured callback URLs fail-closed: only HTTPS callbacks on `chatgpt.com` or `chat.openai.com` with an `/aip/.../oauth/callback` path are retained. The token exchange independently enforces client, resource, PKCE, and redirect binding; the Staging resource profile exposes no Activation resource. Tenant tool discovery and dispatch continue to use the existing runtime deny boundary and stable `tenant_system_tool_route_not_allowed` error for blocked paths and tools.

The CI validator checks both the declarative policy and these runtime invariants. This prevents a policy artifact from drifting away from the code-level enforcement that actually protects Tenant isolation.

## Operational boundary

This change adds governance contracts, runtime callback hardening, and CI enforcement. It does not activate write scopes, grant Tenant delegation, perform database mutations, call providers, or promote anything to Production. The Admin/Tenant inspection policy remains a read-only contract; a future runtime adapter must still bind it to an explicit authority resolver and an auditable route implementation.
