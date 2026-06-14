## Semantic Capability and Tenant-Effective Resolution

The runtime must resolve user intent through a semantic capability before selecting a provider action or endpoint. Provider-specific tool names are projections of effective authority, not independent authority.

### Registry authority

SQL is authoritative for semantic capability resolution through:

- `platform_semantic_capabilities`
- `platform_capability_provider_bindings`
- `platform_endpoint_aliases`
- `workspace_registry`
- `memberships`
- `workspace_app_links`
- `user_app_connections`
- `app_action_grants`
- `workspace_resource_grants`
- `endpoints`
- `runtime_dispatch_certification_registry`
- `platform_endpoint_tool_exports`

### Resolution order

For each request, resolve in this order:

1. Authenticated tenant and user principal.
2. Canonical workspace and active membership.
3. Active semantic capability definition.
4. Ordered provider binding.
5. Workspace-linked connection.
6. Deterministic connection ranking and ambiguity check.
7. Active action grant for the selected connection and parent action.
8. Resource authority appropriate to the capability operation.
9. Canonical endpoint identity through endpoint aliases.
10. Unique ready endpoint row.
11. Current runtime dispatch certification.
12. Derived tool projection and current export state.

Tenant principals may not override tenant or user identity. Admin diagnostic overrides must be explicit in the resolver output.

### Connection selection

Connection selection is deterministic and scoped to active workspace links:

- explicit linked connection: 1000
- validated primary: 900
- validated non-primary: 800
- active primary: 600
- active non-primary: 500

Equal highest-ranked candidates must return `ambiguous_connection`; the runtime must not select one arbitrarily.

### Endpoint identity

Imported operation IDs and historical endpoint keys may map to one canonical endpoint key through `platform_endpoint_aliases`. Runtime execution must block when zero or more than one ready canonical endpoint row exists.

### Rollout modes

Provider bindings support:

- `shadow`: resolve and compare only; no provider call and no active derived export.
- `canary`: bounded approved tenant/workspace scope.
- `active`: normal effective resolution and reconciled export eligibility.
- `disabled`: excluded from resolution.

A shadow binding must never create or activate a tenant tool export.

### Export authority

Tool exports are derived projections. An export is eligible only when the complete tenant-effective chain is ready. Disabling a capability, binding, grant, connection, endpoint, or certification must make the projection non-executable even when a legacy tool row remains present.

### Audit and secrets

Shadow comparisons may write no-secret decision evidence to `tenant_capability_shadow_decisions`. They must not store credentials, tokens, authorization headers, provider request bodies, or provider responses. Runtime responses must state `secrets_included=false`.

### Initial pilot

`content.article.create_draft` may bind to `wordpress_rest` through `wordpress_api/wordpress_create_post` in `shadow` mode. Its adapter must force `status=draft` and reject caller overrides for provider routing or credentials. This pilot does not authorize publishing or provider execution.
