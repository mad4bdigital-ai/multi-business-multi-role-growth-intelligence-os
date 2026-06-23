# Resource API coverage governance

Every user-visible platform feature must resolve to a logical resource descriptor before merge. A descriptor binds source tables, read models, identity, Admin/Tenant scope, safe fields, search policy, lifecycle behavior, permissions, changes, revisions, and readback.

The blocking gate is `platform_resource_api_coverage_policy_v1`. New tables, views, Express routes, or tool exports without descriptor and OpenAPI coverage are merge-blocking. Existing legacy debt remains visible through bounded findings but may not be expanded.

Tenant resource scope is derived from signed JWT, active membership, workspace authority, and applicable resource grants. Client-supplied tenant or user overrides are never trusted. Resource SQL is descriptor-owned; unrestricted table, field, projection, or ordering input is forbidden.

Required operation classes are `list`, `get`, `search`, `permissions`, `changes`, `revisions`, and `readback`. Mutations additionally require validation, authorization, lifecycle semantics, audit, and same-cycle readback. Hard purge is blocked unless separately authorized by retention and capability policy.

Initial governed resource adapters are Sessions, Executions, Workspace Assets, Approval Holds, and Resource API Governance. Session transcript reads return previews and archive pointers only; full content remains behind a future governed Drive transcript adapter.
## Enforced layer boundaries

Resource API requests flow through `routes -> api/controller -> application -> domain`, with persistence and existing runtime services supplied through infrastructure composition. Routes own registration and transport authentication only. Controllers map HTTP contracts. Application services coordinate membership, authorization, lifecycle, audit, and same-cycle readback. Domain modules own descriptors, capabilities, pagination, and typed policy errors. SQL is restricted to infrastructure repositories.

The blocking architecture test rejects SQL or database imports above infrastructure, direct route imports of audit/summary services, and framework dependencies in application/domain modules.
