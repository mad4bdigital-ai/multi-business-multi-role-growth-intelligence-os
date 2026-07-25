# Context Kernel Infrastructure Adapters

This directory contains MySQL-primary adapters for the context-kernel application repository ports.

## Dependency boundary

- Domain and application code depend on repository contracts, not SQL table names.
- Infrastructure adapters may depend on MySQL tables and views.
- Adapters accept an injected SQL pool or lazy pool resolver.
- Adapters do not import Express, route handlers, provider SDKs, or deployment code.
- SQL failures are propagated. They are never converted to empty candidate sets.

## Existing registry sources

| Repository port | Existing source |
|---|---|
| Authorized scope | `memberships`, `workspace_registry` |
| Resource graph | `v_workspace_resource_grant_effective`, `v_effective_platform_resource_authority_bindings` |
| Exact connection | `user_app_connections`, `workspace_app_links`, `app_action_grants` |
| Capability readiness | `v_platform_capability_readiness_vector` |
| Context pin readback | `container_effective_context_ledger` |
| Execution ledger readback | `execution_plans`, `execution_plan_events` |

## Safety rules

- Tenant-scoped reads require an explicit tenant reference.
- Exact lookups use stable references and read at most two rows so duplicate records become explicit ambiguity errors.
- Connection projections never select `encrypted_credentials`.
- Execution projections never select raw `execution_context_json` or event `evidence_json`.
- Context-pin and execution-ledger writes are not implemented in Phase 3 because no dedicated write contract or migration has been approved. Their write methods fail explicitly with stable `*_write_unsupported` errors.
- No schema migration, provider call, external write, or runtime resolver replacement is introduced by these adapters.
