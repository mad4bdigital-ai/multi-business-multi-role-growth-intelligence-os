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
