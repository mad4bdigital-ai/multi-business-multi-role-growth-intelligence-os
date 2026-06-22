# Resource API coverage routing

Route resource intents through the logical resource descriptor before selecting a physical table or provider.

- Read/list/search intents resolve safe projections, scope, and cursor policy.
- Permission intents resolve effective membership and resource grants.
- Changes/revisions intents resolve their declared read models.
- Mutations route only to explicitly enabled lifecycle adapters and require same-cycle readback.
- Unsupported operations return a structured `operation_not_supported` or policy-blocked response.
- Tenant requests cannot override tenant, workspace, or user identity.
