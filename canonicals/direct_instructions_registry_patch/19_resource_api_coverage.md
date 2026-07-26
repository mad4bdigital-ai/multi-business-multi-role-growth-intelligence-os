# Resource API coverage direct enforcement

Do not add or activate a table, view, route, tool export, workflow surface, or feature without a logical resource descriptor and required Admin/Tenant operation coverage.

Before merge, run the Resource API coverage gate. Missing descriptors, OpenAPI paths, test-manifest entries, permission policy, changes/revisions disposition, or mutation readback are blocking. Exemptions must be explicit, justified, and expire.

Never expose raw SQL, secret fields, credential payloads, unrestricted transcript content, or client-controlled scope. Tenant identity is resolved from signed authentication and active membership. DELETE maps to governed archive/revoke/disable/expire behavior; hard purge remains blocked by default.

## Architecture enforcement

Do not place resource SQL, persistence access, lifecycle orchestration, or resource authorization policy inside Express route handlers. Route modules register paths and transport authentication; controllers map HTTP; application services coordinate use cases; domain modules own policy; infrastructure repositories own SQL and external adapters. `test-resource-api-architecture.mjs` is merge-blocking.

## Surface-policy enforcement

Every new table, view, or enabled tool must be declared in the same change as either:

1. a logical resource descriptor or active resource-operation binding; or
2. an active `platform_resource_surface_policy_registry` row with an explicit internal exposure class, `not_applicable` requirement states, and rationale.

Do not use broad regex exemptions to hide ordinary internal surfaces. Do not require physical archive or version columns unless the surface policy explicitly selects those strategies. A resource-facing policy must match its descriptor or operation binding; mismatches are high-severity blocking findings.

## Callability enforcement

Do not treat a registry row, route literal, OpenAPI path, descriptor, or tool export as proof that a surface is callable. Every tool family must declare a callability contract that resolves unique operation keys, an Admin or Tenant descriptor, a callable dispatcher handler, the exact implementation export, safety markers, and an explicit Admin preview fallback while Tenant execution remains disabled. Missing or duplicate keys, missing handlers, missing preview fallbacks, or missing no-provider/no-secret guarantees are merge-blocking.

Disabled Tenant connection operations may be inspected only through `tenant_connection_operation_preview`. The preview may resolve safe connection metadata and assurance/readback evidence, but it must never read credential payloads, call providers, perform writes, change Tenant grants or authority, create exports, or return secrets. Do not enable a Tenant execution route until its executor, adapter overlay, authorization, audit, and same-cycle readback contract are implemented and separately approved.

## Reconciliation enforcement

Do not manually chain low-level Git mutations for PR reconciliation when `repo.pr.reconcile_and_finalize` is available. Use `repository_reconciliation_orchestrator` for dry-run planning and exact SHA evidence. Any multi-parent reconciliation merge commit must require the active orchestrator-held repository lease, matching operation and holder run IDs, recipe key, resource fingerprint, action-specific capability envelope, typed confirmation, and same-cycle ref/tree/ancestry readback before provider access. Reject missing or stale lease evidence before credential resolution. Never force push or write directly to a protected branch.
