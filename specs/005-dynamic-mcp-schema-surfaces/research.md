# Research and Verified Baseline

Observed on **2026-06-25** through governed production read surfaces.

## Runtime authority

`getPlatformDataSourceCensus` reported SQL as runtime authority and Sheets as async mirror/recovery. Exact mapped-registry counts included:

- actions: **39**
- endpoints: **4,141**
- execution policies: **1,225**
- workflows: **257**
- task routes: **215**
- registry surface rows: **22**
- JSON assets: **4,328**
- execution log rows: **15,423**

A separate lifecycle decision brief enumerated **469 database tables**. Its approximate counters are diagnostic estimates and do not replace exact census counts.

## Admin MCP-like catalog

The live DB-backed admin tool catalog reported **480 tools**. Tool `inputSchema` values are returned dynamically and the catalog combines virtual tools, fixed descriptors, and registry endpoint exports.

## System and tenant-capable catalog

The system facade reported protocol `openapi-mcp-facade` and **117 available tools for the current admin principal**. This is not evidence of the exact tenant-visible count. A staging read authenticated with a real tenant JWT is mandatory.

## Binding integrity

`platform_tool_binding_integrity_audit` reported 24 bindings, 24 healthy, and zero gaps for its covered governed GitHub bindings.

## Existing registry surfaces

Verified operational structures include:

- `admin_platform_endpoint_tools` — approximately 454 rows
- `tenant_platform_endpoint_tools` — approximately 121 rows
- `platform_endpoint_tool_exports` — approximately 69 rows
- `platform_contract_surfaces` — approximately 160 rows
- `platform_contract_aliases` — approximately 162 rows
- `platform_contract_relationships` — approximately 29 rows
- `platform_tool_dispatch_bindings`
- `registry_surfaces_catalog`
- `system_layer_tool_descriptor_source_registry`
- `actions`, `endpoints`, and `execution_policies`

Several operational registries, including `registry_surfaces_catalog` and `system_layer_tool_descriptor_source_registry`, are classified as `runtime_unclassified` with `requires_policy`. This is a governance gap, not evidence that they are unused.

## Production OpenAPI findings

### Admin schema

`openapi.custom-gpt.auth-dispatcher.yaml` uses `https://auth.mad4b.com`, combines activation/admin-control/system-layer operations, correctly types `execution_guardrail`, but still contains broad response objects with empty `properties` in some operations.

### Tenant schema

`openapi.tenant-gpt.auth.yaml` uses `https://auth.mad4b.com`, combines Resource API, Activation, Dashboard, MCP facade, Platform Plugins, and session functions, and contains an empty `execution_guardrail` property schema in the published artifact.

## Tool-bus gap

A read-only SQL `SELECT` through generic `admin_control` was blocked with `mutation_policy_required`. The fix is correct read-only classification or a dedicated read-only registry query—not weakening mutation protection.

## Decision

- Git controls public transport topology.
- SQL controls dynamic MCP capability contracts.
- Edge consumes a signed projection, not MySQL.
- Runtime revalidates SQL authority on every execution.
