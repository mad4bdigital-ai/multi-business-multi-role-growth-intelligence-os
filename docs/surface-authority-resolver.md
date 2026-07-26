# Registry Surface Authority Resolver

## Purpose

This phase restores `registry_surfaces_catalog` as a runtime authority source.

The first active use is the `Execution Policy Registry` surface: before `runtimePolicyLoader` reads `execution_policies`, it now verifies that the corresponding registry surface is active, authoritative, and required for execution.

## Runtime module

```text
http-generic-api/surfaceAuthorityResolver.js
```

Exports:

```text
resolveSurfaceAuthority(surfaceKey, options, deps)
assertSurfaceAuthority(surfaceKey, options, deps)
SURFACE_KEYS
```

## First enforcement point

`runtimePolicyLoader.js` now runs:

```text
assertSurfaceAuthority(
  SURFACE_KEYS.EXECUTION_POLICY_REGISTRY,
  { requireExecution: true }
)
→ SELECT ... FROM execution_policies
```

This means `execution_policies` is no longer read in isolation. Its authority now depends on `registry_surfaces_catalog`.

## Surface resolution

The resolver supports:

- `surface_id`
- `logical_surface_key`
- `surface_name`
- legacy alias resolution via `retired_replacement_surface_id`
- active/inactive status classification
- authority status classification
- required-for-execution checks

## Secret-free evidence

The resolver intentionally excludes raw storage identifiers from returned evidence, including:

- `file_id`
- `folder_id`
- `worksheet_gid`
- raw notes that may contain operational detail

It returns metadata such as:

- `surface_id`
- `logical_surface_key`
- `surface_name`
- `storage_type`
- `backend_type`
- `backend_adapter`
- `authority_status`
- `required_for_execution`
- `owner_layer`
- `authority_model`
- `retired_replacement_surface_id`

## Why this matters

The old Workbook/Sheet runtime treated the surface catalog as the source of truth for which registry surfaces were authoritative, required, read-only, write targets, or legacy aliases. After the SQL migration, that table existed but was not an active runtime gate.

This change makes `registry_surfaces_catalog` executable again and gives every future resolver a shared authority check.

## Next targets

The next practical uses should be:

- Brand Core surface check before `loadBrandCoreEvidence`
- Validation & Repair surface check before repair routing
- JSON Asset surface check before memory/session summary writes
- Execution Log surface check before durable execution evidence writes
- Endpoint Registry surface check before provider/admin tool dispatch
