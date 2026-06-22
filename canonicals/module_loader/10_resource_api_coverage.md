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
