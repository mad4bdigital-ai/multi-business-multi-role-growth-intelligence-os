# Dynamic Capability Tool Bus v2

## Purpose

Dynamic Capability Tool Bus v2 makes Custom GPT tool dispatch schema-stable and registry-driven.
It prevents the platform from adding a new OpenAPI enum entry or tenant wrapper for every runtime tool.

## Design rules

1. `/system/tools/call` is a kernel dispatcher, not a target for DB-registered tenant wrappers.
2. `callTool.name` is a runtime tool key string returned by `listTools`; OpenAPI must not enumerate high-churn tool names.
3. Server-side runtime validation remains strict: descriptor resolution, tenant scope, input schema, policy, capability envelope, resource authority, audit, and readback gates.
4. `tenant_platform_endpoint_tools` and `admin_platform_endpoint_tools` are manual route-tool registries only.
5. `platform_endpoint_tool_exports` is the curated endpoint-to-tool exposure bridge for dynamic provider endpoints.
6. Active duplicate tool names across manual route tools and platform endpoint exports are disallowed unless a future explicit precedence policy exists.

## Source responsibilities

### Kernel system tools

Examples: `runtime_endpoint_call`, `runtime_endpoint_preview`, `connector_registry_list`, `governed_resource_run`.

Kernel tools live in code under `SYSTEM_LAYER_TOOLS` and dispatch directly in `callSystemLayerTool`.
They must not be represented as tenant wrappers calling `/system/tools/call` again.

### Manual route tools

Examples: `connect_status`, `support_ticket_create`, `workspace_brands_list`, local gateway tools.

These live in `admin_platform_endpoint_tools` or `tenant_platform_endpoint_tools` and point to real backend routes.
They must not point to `/system/tools/call` or `/gpt/tools/call`.

### Dynamic provider endpoint tools

Examples: WordPress, Google, GitHub, Cloudflare provider operations.

These are curated in `platform_endpoint_tool_exports` and resolved through the system tool facade.
The export row carries GPT-facing input schema, auth policy, and execution policy.

## Dispatch pipeline

1. Resolve tool descriptor by `name` and principal.
2. Validate tenant/admin visibility.
3. Validate request against descriptor input schema.
4. Resolve target/brand/resource context.
5. Resolve credential scope and connection.
6. Check app grants and workspace/resource authority.
7. Check runtime dispatch certification and capability envelope requirements.
8. Run dry-run/preflight when required.
9. Execute the selected adapter.
10. Write audit evidence and perform readback when required.
11. Return a structured success or structured error.

## Why this exists

The WOVacation WordPress draft repair exposed an architectural weakness:
a DB row named `runtime_endpoint_call` pointed back to `/system/tools/call`, creating nested `tool_args` mapping and losing brand target fields before Brand Registry resolution.

The correct model is a stable OpenAPI shell plus dynamic registry descriptors, not self-recursive wrappers or high-churn OpenAPI enums.

## Required invariants

- No active tenant manual route tool may use `/system/tools/call` or `/gpt/tools/call` as its `http_path`.
- `runtime_endpoint_call` must be a kernel system tool.
- `v_platform_exports_current_v2` must include `platform_endpoint_tool_exports` alongside manual tool registries.
- Any provider mutation remains blocked unless capability/resource authority gates allow dispatch and apply.

## Safety

This design does not auto-expose all endpoints.
`platform_endpoint_tool_exports` remains a curated allowlist.
Provider writes remain governed by the endpoint/export execution policy, resource authority, capability envelope, dry-run, audit, and readback gates.
