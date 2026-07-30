# Tool Projection Contract

## Decision

Admin and Tenant tool registries are materialized projections generated from active operation authority. They are not the canonical source for operation identity or execution behavior.

## Projection inputs

A tool is eligible for projection only when all required sources are present and compatible:

- active operation contract and version;
- active generic endpoint and operation route;
- strict input schema and stable output contract;
- authentication and audience policy;
- active execution binding;
- required capability manifest and exportable status;
- adapter/runtime readiness;
- approval, readback, and audit declarations;
- Tenant scope and object-level authorization where applicable.

## Projection pipeline

```text
operation registry
+ step registry
+ endpoint registry
+ schemas
+ auth policy
+ capability manifest
+ execution binding
+ readiness
        ↓
projection compiler
        ↓
validated projection revision
        ↓
Admin/Tenant tool materialization
        ↓
listing and dispatch parity readback
```

## Projection record

```json
{
  "projection_key": "admin.repo_change_execute.v1",
  "operation_key": "repo.change.execute",
  "audience": "admin",
  "tool_key": "repo_change_execute",
  "http_method": "POST",
  "http_path": "/admin/operations/execute",
  "input_schema_revision": "sha256:...",
  "operation_revision": "sha256:...",
  "binding_revision": "sha256:...",
  "projection_revision": "sha256:...",
  "visibility_status": "shadow"
}
```

## Tenant requirements

Tenant projection additionally requires:

- signed-user auth profile;
- server-derived Tenant/user/workspace context;
- strict top-level JSON Schema with `additionalProperties: false`;
- exportable capability-manifest status;
- Tenant-safe output and error schemas;
- no Admin-only fields or authority;
- identical authority for listing and direct dispatch.

## Compiler behavior

The compiler must:

- be deterministic for identical inputs;
- reject duplicate operation/tool identities;
- reject route/schema/auth mismatches;
- reject missing or open Tenant schemas;
- reject bindings without active readiness;
- record every source revision and compiler version;
- produce a diff and impact summary;
- support dry-run, shadow materialization, apply, rollback, and check modes;
- advance catalog cache revisions after successful apply;
- require same-cycle listing and dispatch readback.

## Rollback

Every applied projection revision points to the prior revision. Rollback restores the prior materialized rows, cache version, and visibility state without changing operation contracts or execution code.

## Compatibility

Existing manually registered tools remain available during dual-read. The compiler classifies each as:

- exact match;
- compatible alias;
- projection-only candidate;
- legacy-only;
- conflicting;
- blocked by missing authority.

Conflicting tools remain disabled until reviewed.
