# Resource API coverage dependencies

Before loading a resource operation, resolve:

1. `platform_resource_type_registry`;
2. `platform_resource_operation_registry`;
3. signed principal and tenant/workspace membership;
4. resource permission adapter and resource grants;
5. safe-field and search policy;
6. lifecycle, revision, and changes adapters;
7. audit and readback requirements.

Missing or ambiguous bindings return a typed blocked state. Loaders must not construct SQL from client-selected tables, columns, projections, or order expressions.

## Layer loading order

Load resource operations in this order: domain catalog and typed policy, infrastructure repository ports, application service, API controller, then route registration. Runtime composition supplies the SQL pool, summary service, and live coverage auditor. Missing composition dependencies fail before request execution; routes must not resolve database or provider dependencies directly.

## Surface policy loading

For table, view, and tool coverage audits, load `platform_resource_surface_policy_registry` before evaluating requirements. Resolve the surface kind and reference, exposure class, optional resource key, descriptor requirement, operation requirement, archive requirement, version requirement, rationale, and active status.

A missing active policy is a high-severity gap unless the relation is an explicitly recognized recovery snapshot. For resource-facing surfaces, also load and compare the matching resource descriptor or operation binding. For internal surfaces, require explicit `not_applicable` states rather than inferring non-exposure from naming alone.
