# Resource API coverage routing

Route resource intents through the logical resource descriptor before selecting a physical table or provider.

- Read/list/search intents resolve safe projections, scope, and cursor policy.
- Permission intents resolve effective membership and resource grants.
- Changes/revisions intents resolve their declared read models.
- Mutations route only to explicitly enabled lifecycle adapters and require same-cycle readback.
- Unsupported operations return a structured `operation_not_supported` or policy-blocked response.
- Tenant requests cannot override tenant, workspace, or user identity.

## Route boundary

Prompt and HTTP routing select the application operation but do not execute persistence or policy logic in the route layer. Resource intent reaches a controller, then the application service, domain policy, and an injected infrastructure repository. Structured application errors are translated to stable HTTP envelopes at the API boundary.

## Surface-policy routing

Coverage and discovery intents resolve a surface-policy decision before treating a table, view, or tool as a logical resource. A `resource_source`, `resource_read_model`, or `resource_tool` decision routes to the matching descriptor or operation registry. Internal exposure classes route only to governance and audit views and never create public SQL-shaped APIs.

A missing policy, a required descriptor without coverage, a required tool operation without binding, or a policy/descriptor mismatch returns a typed blocking finding. Archive and version checks route according to the selected policy strategy rather than generic physical-column assumptions.
