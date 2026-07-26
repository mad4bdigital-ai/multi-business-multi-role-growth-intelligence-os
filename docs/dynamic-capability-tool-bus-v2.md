# Dynamic Capability Tool Bus v2

The Dynamic Capability Tool Bus is the remaining kernel path for descriptor-driven tool dispatch. It is separate from Support Ticket lifecycle cleanup, External Delivery no-send certification, and Session Insight capability-envelope gates.

## Target milestones

1. `resolveToolDescriptor(name, principal)` resolves the runtime descriptor from registry/export authority.
2. Unified catalog merges kernel tools, tenant-safe registry tools, and `platform_endpoint_tool_exports` without collision.
3. Registry collision guard blocks self-recursive or duplicate tool surfaces.
4. Descriptor-driven OpenAPI exposes stable shell operations while server-side validation resolves dynamic tool names.
5. Dispatch validates principal, scope, input schema, target resource, credential binding, app grant, capability envelope, dry-run/preflight, execution adapter, audit, and readback.

## Current boundary

`runtime_endpoint_call` must remain a kernel-level tool. Tenant registry wrappers that point back into `/system/tools/call` remain blocked to avoid recursive dispatch.

## Safety

Tool Bus v2 must first ship as descriptor/readiness/dry-run. Live provider execution requires separate capability authorization and readback evidence.
