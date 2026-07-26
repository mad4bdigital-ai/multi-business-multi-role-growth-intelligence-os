# Data Model

## platform_resource_type_registry

Defines one logical resource independent of physical table count.

Key fields: `resource_key`, `scope_class`, `id_field`, source/read-model JSON, operation policy, field policy, search policy, status.

## platform_resource_operation_registry

Defines actor scope, operation, HTTP contract, route implementation, tool export, permission requirement, and readback requirement.

## platform_resource_coverage_runs

Stores bounded audit-run metadata and aggregate totals. It never stores credentials or raw resource payloads.

## platform_resource_coverage_findings

Stores typed findings for missing lifecycle registration, missing resource descriptors, unexported read models, scope/version/archive weaknesses, and unlinked tools.

## Initial resources

- `sessions`
- `executions`
- `assets`
- `approvals`
- `resource_api_governance`
