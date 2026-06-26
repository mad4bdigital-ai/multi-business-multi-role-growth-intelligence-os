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
