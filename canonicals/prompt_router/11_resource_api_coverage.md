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
